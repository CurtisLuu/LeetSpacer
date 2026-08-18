import { describe, expect, it } from "vitest";

import { ingestEvents } from "./ingest.js";
import { createMemoryStore } from "./memory-store.js";
import { type ProgressEvent, type ProviderId, type TrackId, eventId } from "./model.js";
import { rebuildTrackSchedule } from "./reschedule.js";
import { createScheduler } from "./scheduler.js";
import { seedMissingCards } from "./seed-cards.js";
import type { Store } from "./store.js";

/**
 * LeetCode and NeetCode are two applications that happen to share a process.
 *
 * They have separate histories, separate problem records, separate schedules, separate
 * pacing and separate on/off switches; the only thing they share is the slug that names a
 * problem, and that is a coincidence of vocabulary rather than a shared record. Every
 * serious bug this system has had came from one of them reaching into the other's data:
 * merged problem rows that carried a date from one site and an attempt count from the
 * other, a rescheduler keyed on slug alone that let a dateless NeetCode row overwrite a
 * real LeetCode schedule.
 *
 * These are the invariants that say so, at the level the whole app is built on.
 */

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function solved(provider: ProviderId, slug: string, at: number): ProgressEvent {
  return {
    id: eventId(provider, "submission_result", slug, at),
    type: "submission_result",
    provider,
    slug,
    verdict: "accepted",
    submittedAt: at,
    observedAt: at,
  };
}

/** NeetCode's shape: it knows *that* you finished something, never when. */
function completed(slug: string, observedAt: number): ProgressEvent {
  return {
    id: eventId("neetcode", "problem_solved", slug, 0, "completed"),
    type: "problem_solved",
    provider: "neetcode",
    slug,
    solvedAt: observedAt,
    observedAt,
  };
}

async function bothSitesSolved(slug = "two-sum"): Promise<Store> {
  const store = createMemoryStore();
  // A year apart, so a schedule derived from one is unmistakable next to the other.
  await ingestEvents(store, [solved("leetcode", slug, T0), completed(slug, T0 + 365 * DAY)]);
  await seedMissingCards(store, T0 + 365 * DAY);
  return store;
}

describe("two sites, two applications", () => {
  it("keeps a problem solved on both as two separate records", async () => {
    const store = await bothSitesSolved();

    const leetcode = await store.problems.get("leetcode", "two-sum");
    const neetcode = await store.problems.get("neetcode", "two-sum");

    expect(leetcode?.lastSolvedAt).toBe(T0);
    expect(leetcode?.hasDatedSolve).toBe(true);
    // NeetCode's completed set carries no date, so its record says so rather than
    // borrowing the one LeetCode has.
    expect(neetcode?.hasDatedSolve).toBe(false);
    expect(await store.problems.all()).toHaveLength(2);
  });

  it("gives it a card in each track, scheduled independently", async () => {
    const store = await bothSitesSolved();

    const leetcodeCard = await store.cards.get("leetcode", "two-sum");
    const neetcodeCard = await store.cards.get("neetcode", "two-sum");

    expect(leetcodeCard).toBeDefined();
    expect(neetcodeCard).toBeDefined();
    // Same problem, different evidence, so different schedules. Equal due dates here
    // would mean one of them was seeded from the other's record.
    expect(leetcodeCard?.due).not.toBe(neetcodeCard?.due);
  });

  it("leaves the other track alone when one is graded", async () => {
    const store = await bothSitesSolved();
    const before = await store.cards.get("neetcode", "two-sum");

    const scheduler = createScheduler({ requestRetention: 0.9 });
    const card = await store.cards.get("leetcode", "two-sum");
    const { card: graded, log } = scheduler.review(card!, 3, T0 + 400 * DAY);
    await store.cards.put([graded]);
    await store.logs.append([log]);

    expect(await store.cards.get("neetcode", "two-sum")).toEqual(before);
    // And the grade itself belongs to one track only.
    expect(await store.logs.forProblem("neetcode", "two-sum")).toEqual([]);
    expect(await store.logs.forProblem("leetcode", "two-sum")).toHaveLength(1);
  });

  it("counts each track's work separately", async () => {
    const store = createMemoryStore();
    await ingestEvents(store, [
      solved("leetcode", "two-sum", T0),
      solved("leetcode", "valid-anagram", T0 + DAY),
      completed("two-sum", T0),
    ]);
    await seedMissingCards(store, T0 + DAY);

    expect(await store.problems.countSolved("leetcode")).toBe(2);
    expect(await store.problems.countSolved("neetcode")).toBe(1);
    expect(await store.events.count("leetcode")).toBe(2);
    expect(await store.events.count("neetcode")).toBe(1);
    expect(await store.cards.count("leetcode")).toBe(2);
    expect(await store.cards.count("neetcode")).toBe(1);
  });

  it("refuses to file anything under a track that isn't one of the two", async () => {
    const store = createMemoryStore();
    const card = {
      track: "codewars" as TrackId,
      slug: "two-sum",
      due: T0,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      phase: "new" as const,
      lastReview: null,
    };

    // There is no third schedule to read it back out of, so accepting it would mean
    // writing a card nothing can ever show.
    await expect(store.cards.put([card])).rejects.toThrow(/track must be/);
  });
});

describe("rescheduling one track", () => {
  /**
   * The bug this exists to prevent, in full: apply the seeding strategy to the LeetCode
   * track for a problem solved on both sites, and the dateless NeetCode row wins because
   * the two were keyed by slug alone — replacing a schedule derived from a real
   * submission date with a seeded guess.
   */
  it("reads only its own provider's records", async () => {
    const store = await bothSitesSolved();
    const dated = await store.cards.get("leetcode", "two-sum");

    const result = await rebuildTrackSchedule(store, "leetcode", T0 + 365 * DAY);

    expect(result.rebuilt).toBe(1);
    // Re-seeded from LeetCode's own solve date, so it lands exactly where it already was.
    expect((await store.cards.get("leetcode", "two-sum"))?.due).toBe(dated?.due);
  });

  it("doesn't touch the other track's cards", async () => {
    const store = await bothSitesSolved();
    const untouched = await store.cards.get("neetcode", "two-sum");

    await rebuildTrackSchedule(store, "leetcode", T0 + 365 * DAY);

    expect(await store.cards.get("neetcode", "two-sum")).toEqual(untouched);
  });

  it("keeps anything already graded, in that track only", async () => {
    const store = await bothSitesSolved();
    const scheduler = createScheduler({ requestRetention: 0.9 });
    const card = await store.cards.get("leetcode", "two-sum");
    const { card: graded, log } = scheduler.review(card!, 3, T0 + 400 * DAY);
    await store.cards.put([graded]);
    await store.logs.append([log]);

    const leetcode = await rebuildTrackSchedule(store, "leetcode", T0 + 400 * DAY);
    const neetcode = await rebuildTrackSchedule(store, "neetcode", T0 + 400 * DAY);

    expect(leetcode).toEqual({ rebuilt: 0, kept: 1 });
    // The same problem in the other track has no review history of its own, so it is
    // re-seeded rather than kept — the grade did not follow it across.
    expect(neetcode).toEqual({ rebuilt: 1, kept: 0 });
    expect((await store.cards.get("leetcode", "two-sum"))?.due).toBe(graded.due);
  });

  it("spreads only the dateless cards, using that track's own settings", async () => {
    const store = createMemoryStore();
    await ingestEvents(store, [completed("two-sum", T0), completed("valid-anagram", T0)]);
    await seedMissingCards(store, T0);
    await store.settings.update({
      tracks: {
        ...(await store.settings.get()).tracks,
        neetcode: { ...(await store.settings.get()).tracks.neetcode, seedSpreadDays: 4 },
      },
    });

    await rebuildTrackSchedule(store, "neetcode", T0);

    const cards = await store.cards.all("neetcode");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.due).toBeGreaterThanOrEqual(T0);
      expect(card.due).toBeLessThanOrEqual(T0 + 4 * DAY);
    }
  });
});

describe("starting one track over", () => {
  async function bothPopulated(): Promise<Store> {
    const store = await bothSitesSolved();
    await ingestEvents(store, [
      solved("leetcode", "valid-anagram", T0 + DAY),
      completed("valid-anagram", T0 + 365 * DAY),
    ]);
    await seedMissingCards(store, T0 + 365 * DAY);

    // A grade in each track, so the review log has something to lose on both sides.
    const scheduler = createScheduler({ requestRetention: 0.9 });
    for (const track of ["leetcode", "neetcode"] as const) {
      const card = await store.cards.get(track, "two-sum");
      const { card: graded, log } = scheduler.review(card!, 3, T0 + 400 * DAY);
      await store.cards.put([graded]);
      await store.logs.append([log]);
    }
    return store;
  }

  it("erases that site's history, schedule and grades", async () => {
    const store = await bothPopulated();

    const cleared = await store.clearTrack("leetcode");

    expect(cleared).toEqual({ events: 2, problems: 2, cards: 2, logs: 1 });
    expect(await store.events.count("leetcode")).toBe(0);
    expect(await store.problems.all("leetcode")).toEqual([]);
    expect(await store.cards.all("leetcode")).toEqual([]);
    expect(await store.logs.forProblem("leetcode", "two-sum")).toEqual([]);
  });

  it("leaves the other track exactly as it was", async () => {
    const store = await bothPopulated();
    const before = {
      events: await store.events.count("neetcode"),
      problems: await store.problems.all("neetcode"),
      cards: await store.cards.all("neetcode"),
      logs: await store.logs.forProblem("neetcode", "two-sum"),
    };

    await store.clearTrack("leetcode");

    expect(await store.events.count("neetcode")).toBe(before.events);
    expect(await store.problems.all("neetcode")).toEqual(before.problems);
    expect(await store.cards.all("neetcode")).toEqual(before.cards);
    expect(await store.logs.forProblem("neetcode", "two-sum")).toEqual(before.logs);
  });

  it("rewinds only that source's sync cursors", async () => {
    const store = await bothPopulated();
    await store.settings.patchProvider("leetcode", {
      username: "someone",
      lastFullSyncAt: T0,
      lastIncrementalSyncAt: T0,
    });
    await store.settings.patchProvider("neetcode", { lastFullSyncAt: T0 });

    await store.clearTrack("leetcode");
    const settings = await store.settings.get();

    // Null cursors are what make the next visit walk the whole history again. Leaving
    // them would ask the site for "anything since the sync that produced what we just
    // deleted", and the track would stay empty for good.
    expect(settings.providers.leetcode.lastFullSyncAt).toBeNull();
    expect(settings.providers.leetcode.lastIncrementalSyncAt).toBeNull();
    expect(settings.providers.leetcode.username).toBeNull();
    expect(settings.providers.neetcode.lastFullSyncAt).toBe(T0);
  });

  it("keeps the choices, which aren't data", async () => {
    const store = await bothPopulated();
    await store.settings.patchProvider("leetcode", { enabled: false });
    await store.settings.patchTrack("leetcode", { dailyReviewLimit: 42 });

    await store.clearTrack("leetcode");
    const settings = await store.settings.get();

    expect(settings.providers.leetcode.enabled).toBe(false);
    expect(settings.tracks.leetcode.dailyReviewLimit).toBe(42);
  });

  it("really starts over: the same history seeds a fresh schedule", async () => {
    const store = await bothPopulated();
    const graded = await store.cards.get("leetcode", "two-sum");

    await store.clearTrack("leetcode");
    // What happens when the site is opened again: the same events arrive, with the same
    // deterministic ids, and seed a card from scratch.
    await ingestEvents(store, [solved("leetcode", "two-sum", T0)]);
    await seedMissingCards(store, T0 + 400 * DAY, "leetcode");

    const fresh = await store.cards.get("leetcode", "two-sum");
    expect(await store.cards.count("leetcode")).toBe(1);
    // Seeded, not resumed: the review that had been recorded against it is gone, so the
    // card is back to what a first sync would have produced.
    expect(fresh?.reps).toBeLessThan(graded!.reps);
    expect(await store.logs.forProblem("leetcode", "two-sum")).toEqual([]);
  });
});
