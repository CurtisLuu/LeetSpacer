import { describe, expect, it } from "vitest";

import { ingestEvents } from "./ingest.js";
import { createMemoryStore } from "./memory-store.js";
import { type ProgressEvent, type ProviderId, type Timestamp, eventId } from "./model.js";
import { createScheduler } from "./scheduler.js";
import { seedMissingCards } from "./seed-cards.js";
import type { Settings } from "./settings.js";
import type { Store } from "./store.js";

const NOW = Date.UTC(2026, 7, 17);
const DAY = 86_400_000;

/** A dated LeetCode submission — the shape that carries a real solve time. */
function submission(
  slug: string,
  at: Timestamp,
  verdict: "accepted" | "wrong_answer" = "accepted",
  id = `${slug}-${at}`,
): ProgressEvent {
  return {
    id: eventId("leetcode", "submission_result", slug, 0, id),
    type: "submission_result",
    provider: "leetcode",
    slug,
    verdict,
    submittedAt: at,
    observedAt: NOW,
  };
}

/** A dateless "this is done" — NeetCode's only signal, and LeetCode's AC-list backfill. */
function completed(slug: string, provider: ProviderId = "neetcode"): ProgressEvent {
  return {
    id: eventId(provider, "problem_solved", slug, 0, "set"),
    type: "problem_solved",
    provider,
    slug,
    solvedAt: NOW,
    observedAt: NOW,
  };
}

async function seeded(events: ProgressEvent[], patch?: Partial<Settings>): Promise<Store> {
  const store = createMemoryStore();
  if (patch) await store.settings.update(patch);
  await ingestEvents(store, events);
  await seedMissingCards(store, NOW);
  return store;
}

describe("seedMissingCards", () => {
  it("puts a LeetCode-only problem in the LeetCode track and nowhere else", async () => {
    const store = await seeded([submission("two-sum", NOW - 30 * DAY)]);

    expect(await store.cards.get("leetcode", "two-sum")).toBeDefined();
    expect(await store.cards.get("neetcode", "two-sum")).toBeUndefined();
  });

  it("puts a NeetCode-only problem in the NeetCode track and nowhere else", async () => {
    const store = await seeded([completed("is-anagram")]);

    expect(await store.cards.get("neetcode", "is-anagram")).toBeDefined();
    expect(await store.cards.get("leetcode", "is-anagram")).toBeUndefined();
  });

  it("seeds each track from its own provider's record, not a merged one", async () => {
    const store = await seeded([submission("two-sum", NOW - 200 * DAY), completed("two-sum")]);

    const leetcode = await store.cards.get("leetcode", "two-sum");
    const neetcode = await store.cards.get("neetcode", "two-sum");

    expect(leetcode).toBeDefined();
    expect(neetcode).toBeDefined();
    // LeetCode watched the submission land 200 days ago, so its card is dated from then.
    expect(leetcode!.lastReview).toBe(NOW - 200 * DAY);
    // NeetCode only ever said "done", so its card is seeded from now. Previously the two
    // shared one record and the NeetCode card inherited LeetCode's date — a solve NeetCode
    // never witnessed.
    expect(neetcode!.lastReview).toBe(NOW);
  });

  it("keeps attempt counts on the provider that observed them", async () => {
    // Three LeetCode submissions seed a harder card there; NeetCode saw none of them and
    // must not inherit the difficulty they imply.
    const store = await seeded([
      submission("two-sum", NOW - 10 * DAY, "wrong_answer", "a"),
      submission("two-sum", NOW - 10 * DAY, "wrong_answer", "b"),
      submission("two-sum", NOW - 9 * DAY, "accepted", "c"),
      completed("two-sum"),
    ]);

    const leetcode = await store.problems.get("leetcode", "two-sum");
    const neetcode = await store.problems.get("neetcode", "two-sum");

    expect(leetcode!.attempts).toBe(3);
    expect(neetcode!.attempts).toBe(0);

    const harder = (await store.cards.get("leetcode", "two-sum"))!.difficulty;
    const easier = (await store.cards.get("neetcode", "two-sum"))!.difficulty;
    expect(harder).toBeGreaterThan(easier);
  });

  it("keeps the two copies independent once one is graded", async () => {
    const store = await seeded([submission("two-sum", NOW - 200 * DAY), completed("two-sum")]);
    const before = await store.cards.get("neetcode", "two-sum");

    const scheduler = createScheduler();
    const { card } = scheduler.review(
      (await store.cards.get("leetcode", "two-sum"))!,
      3,
      NOW,
    );
    await store.cards.put([card]);

    expect((await store.cards.get("neetcode", "two-sum"))).toEqual(before);
    expect((await store.cards.get("leetcode", "two-sum"))!.reps).toBe(before!.reps + 1);
  });

  it("schedules a dated LeetCode solve from when it actually happened", async () => {
    const store = await seeded([submission("two-sum", NOW - 200 * DAY)]);
    const card = await store.cards.get("leetcode", "two-sum");

    expect(card!.lastReview).toBe(NOW - 200 * DAY);
    // Long overdue: solved 200 days ago with a short first interval.
    expect(card!.due).toBeLessThan(NOW);
  });

  it("does not redistribute dated cards", async () => {
    // The bug this guards: fanning a real schedule across the seeding window would throw
    // away the best information the system has.
    const store = await seeded([
      submission("a", NOW - 300 * DAY),
      submission("b", NOW - 200 * DAY),
      submission("c", NOW - 100 * DAY),
    ]);

    const cards = await store.cards.all("leetcode");
    const dues = cards.map((c) => c.due).sort((x, y) => x - y);

    // Three distinct historical due dates, all in the past — not three points fanned
    // forward across the next 30 days.
    expect(new Set(dues).size).toBe(3);
    expect(dues.every((due) => due < NOW)).toBe(true);
  });

  it("does redistribute the dateless ones", async () => {
    const slugs = ["a", "b", "c", "d", "e", "f"];
    const store = await seeded(slugs.map((slug) => completed(slug)));

    const dues = (await store.cards.all("neetcode")).map((c) => c.due);
    // Spread across the window rather than every card landing on the same day.
    expect(new Set(dues).size).toBeGreaterThan(1);
    expect(Math.min(...dues)).toBeGreaterThanOrEqual(NOW);
  });

  it("treats LeetCode's dateless backfill as needing a strategy too", async () => {
    // The accepted-set query has no timestamps, so those problems are seeded, not dated.
    const store = await seeded([completed("valid-anagram", "leetcode")]);
    const card = await store.cards.get("leetcode", "valid-anagram");

    expect(card).toBeDefined();
    expect(card!.due).toBeGreaterThanOrEqual(NOW);
  });

  it("ignores problems that were only ever attempted", async () => {
    const store = await seeded([submission("hard-one", NOW - DAY, "wrong_answer")]);

    expect(await store.cards.all()).toEqual([]);
  });

  it("never disturbs a card that already exists", async () => {
    const store = await seeded([submission("two-sum", NOW - 30 * DAY)]);
    const before = await store.cards.get("leetcode", "two-sum");

    // A later sync sees the same problem again, plus a new one.
    await ingestEvents(store, [submission("3sum", NOW - 10 * DAY)]);
    await seedMissingCards(store, NOW + DAY);

    expect(await store.cards.get("leetcode", "two-sum")).toEqual(before);
    expect(await store.cards.get("leetcode", "3sum")).toBeDefined();
  });

  it("is safe to run after every page of a paged sync", async () => {
    // The background calls this on each ingest batch, so repeated runs must converge
    // rather than pile up duplicates or drift.
    const store = createMemoryStore();

    for (let page = 0; page < 5; page++) {
      await ingestEvents(store, [submission(`problem-${page}`, NOW - page * DAY)]);
      await seedMissingCards(store, NOW);
    }

    const cards = await store.cards.all("leetcode");
    expect(cards).toHaveLength(5);
    expect(new Set(cards.map((c) => c.slug)).size).toBe(5);
  });

  it("reports what it created, per track", async () => {
    const store = createMemoryStore();
    await ingestEvents(store, [
      submission("two-sum", NOW - DAY),
      submission("3sum", NOW - DAY),
      completed("is-anagram"),
    ]);

    const result = await seedMissingCards(store, NOW);
    expect(result).toEqual({ seeded: { leetcode: 2, neetcode: 1 }, total: 3 });

    // Nothing left to do the second time.
    expect((await seedMissingCards(store, NOW)).total).toBe(0);
  });

  it("uses each track's own seeding window", async () => {
    const store = createMemoryStore();
    const settings = await store.settings.get();
    await store.settings.update({
      tracks: {
        leetcode: { ...settings.tracks.leetcode, seedStrategy: "now" },
        neetcode: { ...settings.tracks.neetcode, seedStrategy: "spread", seedSpreadDays: 40 },
      },
    });

    await ingestEvents(store, [
      ...["a", "b", "c", "d"].map((s) => completed(s, "leetcode")),
      ...["w", "x", "y", "z"].map((s) => completed(s)),
    ]);
    await seedMissingCards(store, NOW);

    // "now" means exactly that, for every card in that track.
    expect((await store.cards.all("leetcode")).every((c) => c.due === NOW)).toBe(true);
    // The other track kept its spread, untouched by the first track's setting.
    expect(new Set((await store.cards.all("neetcode")).map((c) => c.due)).size).toBeGreaterThan(1);
  });
});
