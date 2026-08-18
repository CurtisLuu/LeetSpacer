import "fake-indexeddb/auto";

import {
  type ProgressEvent,
  type ReviewCard,
  type TrackId,
  createMemoryStore,
  eventId,
  ingestEvents,
} from "@lcs/core";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdbStore, openLcsDb } from "./idb-store.js";

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

let dbCounter = 0;

async function freshStore() {
  dbCounter += 1;
  return createIdbStore(await openLcsDb(`lcs-test-${dbCounter}`));
}

function submission(slug: string, at: number, verdict: "accepted" | "wrong_answer"): ProgressEvent {
  return {
    id: eventId("leetcode", "submission_result", slug, at),
    type: "submission_result",
    provider: "leetcode",
    slug,
    verdict,
    submittedAt: at,
    observedAt: at,
  };
}

function log(track: TrackId, slug: string, reviewedAt: number) {
  return {
    id: `${track}:${slug}:${reviewedAt}`,
    track,
    slug,
    rating: 3 as const,
    reviewedAt,
    elapsedDays: 1,
    scheduledDays: 2,
    phase: "review" as const,
    source: "manual" as const,
  };
}

function card(slug: string, due: number, track: TrackId = "neetcode"): ReviewCard {
  return {
    track,
    slug,
    due,
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    phase: "review",
    lastReview: T0,
  };
}

const SAMPLE: ProgressEvent[] = [
  submission("two-sum", T0, "wrong_answer"),
  submission("two-sum", T0 + DAY, "accepted"),
  submission("valid-anagram", T0 + 2 * DAY, "accepted"),
];

describe("IndexedDB store", () => {
  let store: Awaited<ReturnType<typeof freshStore>>;

  beforeEach(async () => {
    store = await freshStore();
  });

  it("dedupes events by id on append", async () => {
    const first = await store.events.append(SAMPLE);
    const second = await store.events.append(SAMPLE);

    expect(first).toHaveLength(3);
    expect(second).toHaveLength(0);
    expect(await store.events.count()).toBe(3);
  });

  it("counts events per provider, and in total", async () => {
    await store.events.append([
      ...SAMPLE,
      {
        id: eventId("neetcode", "problem_solved", "two-sum", 0, "completed"),
        type: "problem_solved",
        provider: "neetcode",
        slug: "two-sum",
        solvedAt: T0,
        observedAt: T0,
      },
    ]);

    // The panel shows this next to two track-scoped numbers, so it has to be scoped too.
    expect(await store.events.count("leetcode")).toBe(3);
    expect(await store.events.count("neetcode")).toBe(1);
    expect(await store.events.count()).toBe(4);
  });

  it("queries events by observation time", async () => {
    await store.events.append(SAMPLE);

    const recent = await store.events.since(T0 + DAY);
    expect(recent.map((e) => e.slug)).toEqual(["valid-anagram"]);
  });

  it("returns due cards in due order, respecting the limit", async () => {
    await store.cards.put([card("c", T0 + 3 * DAY), card("a", T0 + DAY), card("b", T0 + 2 * DAY)]);

    const due = await store.cards.due("neetcode", T0 + 2 * DAY);
    expect(due.map((c) => c.slug)).toEqual(["a", "b"]);

    const capped = await store.cards.due("neetcode", T0 + 10 * DAY, 2);
    expect(capped.map((c) => c.slug)).toEqual(["a", "b"]);
  });

  it("keeps the two tracks' schedules apart", async () => {
    // The same problem in both tracks: independent cards, independent due dates.
    await store.cards.put([
      card("two-sum", T0 + DAY, "neetcode"),
      card("two-sum", T0 + 9 * DAY, "leetcode"),
      card("3sum", T0 + DAY, "leetcode"),
    ]);

    const neetcode = await store.cards.due("neetcode", T0 + 2 * DAY);
    expect(neetcode.map((c) => c.slug)).toEqual(["two-sum"]);

    // The LeetCode copy of two-sum isn't due yet, and 3sum isn't in the NeetCode track.
    const leetcode = await store.cards.due("leetcode", T0 + 2 * DAY);
    expect(leetcode.map((c) => c.slug)).toEqual(["3sum"]);

    expect(await store.cards.get("leetcode", "two-sum")).toMatchObject({ due: T0 + 9 * DAY });
    expect(await store.cards.get("neetcode", "two-sum")).toMatchObject({ due: T0 + DAY });
    expect(await store.cards.get("leetcode", "climbing-stairs")).toBeUndefined();
  });

  it("removes a card from one track without touching the other", async () => {
    await store.cards.put([
      card("two-sum", T0 + DAY, "neetcode"),
      card("two-sum", T0 + DAY, "leetcode"),
    ]);

    await store.cards.remove("neetcode", "two-sum");

    expect(await store.cards.get("neetcode", "two-sum")).toBeUndefined();
    expect(await store.cards.get("leetcode", "two-sum")).toBeDefined();
    expect(await store.cards.all()).toHaveLength(1);
    expect(await store.cards.all("leetcode")).toHaveLength(1);
  });

  it("round-trips settings with defaults filled in", async () => {
    const current = await store.settings.get();
    const updated = await store.settings.update({
      tracks: {
        ...current.tracks,
        neetcode: { ...current.tracks.neetcode, seedSpreadDays: 21, dailyNewLimit: 3 },
      },
    });

    expect(updated.tracks.neetcode.seedSpreadDays).toBe(21);
    expect(updated.tracks.neetcode.dailyNewLimit).toBe(3);
    // Untouched fields keep their defaults...
    expect(updated.tracks.neetcode.requestRetention).toBe(0.9);
    // ...and so does the whole of the other track. Tuning one must not move the other.
    expect(updated.tracks.leetcode).toEqual(current.tracks.leetcode);
    expect((await store.settings.get()).tracks.neetcode.seedSpreadDays).toBe(21);
  });

  it("doesn't lose a settings write made from another connection", async () => {
    // Four contexts hold their own handle to this database. The options page saving a
    // whole settings object while the background records a sync timestamp used to mean
    // whichever wrote last silently undid the other — a source switched off in Settings
    // could come back on by itself. One transaction per update is what stops it.
    dbCounter += 1;
    const name = `lcs-concurrent-${dbCounter}`;
    const optionsPage = createIdbStore(await openLcsDb(name));
    const background = createIdbStore(await openLcsDb(name));

    await Promise.all([
      // Someone switching NeetCode off in Settings, while the background records a
      // finished LeetCode sync. Each names one source, so neither carries a copy of the
      // other's state to overwrite it with.
      optionsPage.settings.patchProvider("neetcode", { enabled: false }),
      background.settings.patchProvider("leetcode", { lastFullSyncAt: T0 }),
    ]);

    const settled = await background.settings.get();
    expect(settled.providers.neetcode.enabled).toBe(false);
    expect(settled.providers.leetcode.lastFullSyncAt).toBe(T0);
  });

  it("keeps one track's schedule settings out of the other's writes", async () => {
    dbCounter += 1;
    const name = `lcs-tracks-${dbCounter}`;
    const first = createIdbStore(await openLcsDb(name));
    const second = createIdbStore(await openLcsDb(name));

    await Promise.all([
      first.settings.patchTrack("leetcode", { dailyReviewLimit: 40 }),
      second.settings.patchTrack("neetcode", { dailyReviewLimit: 3 }),
    ]);

    const settled = await first.settings.get();
    expect(settled.tracks.leetcode.dailyReviewLimit).toBe(40);
    expect(settled.tracks.neetcode.dailyReviewLimit).toBe(3);
  });

  it("keeps meta keys separate from settings", async () => {
    await store.meta.set("leetcode:cursor", 12345);
    await store.settings.update({ activeTrack: "leetcode" });

    expect(await store.meta.get<number>("leetcode:cursor")).toBe(12345);
    expect((await store.settings.get()).activeTrack).toBe("leetcode");
  });

  it("exports and re-imports a snapshot without loss", async () => {
    await ingestEvents(store, SAMPLE);
    const snapshot = await store.exportSnapshot();

    const restored = await freshStore();
    await restored.importSnapshot(snapshot, "replace");

    expect(await restored.events.count()).toBe(3);
    expect((await restored.problems.get("leetcode", "two-sum"))?.acceptedCount).toBe(1);
  });

  it("never lets an import grant consent", async () => {
    // A snapshot is a file the user picked, not a decision they made. Accepting a policy
    // is a decision they made, so it cannot arrive in a file — see `settingsWithoutConsent`.
    await ingestEvents(store, SAMPLE);
    const snapshot = await store.exportSnapshot();
    snapshot.settings = {
      ...snapshot.settings,
      privacyAcceptedAt: T0,
      privacyAcceptedVersion: 1,
      activeTrack: "leetcode",
    };

    const restored = await freshStore();
    await restored.importSnapshot(snapshot, "replace");

    const settings = await restored.settings.get();
    expect(settings.privacyAcceptedAt).toBeNull();
    expect(settings.privacyAcceptedVersion).toBeNull();
    // Everything that isn't consent still restores.
    expect(settings.activeTrack).toBe("leetcode");
    expect(await restored.events.count()).toBe(3);
  });

  it("leaves an existing acceptance alone on import", async () => {
    await store.settings.update({ privacyAcceptedAt: T0, privacyAcceptedVersion: 1 });
    const snapshot = await store.exportSnapshot();
    snapshot.settings = {
      ...snapshot.settings,
      privacyAcceptedAt: null,
      privacyAcceptedVersion: null,
    };

    await store.importSnapshot(snapshot, "merge");

    const settings = await store.settings.get();
    expect(settings.privacyAcceptedAt).toBe(T0);
    expect(settings.privacyAcceptedVersion).toBe(1);
  });

  it("agrees with the in-memory reference implementation", async () => {
    const memory = createMemoryStore();

    await ingestEvents(store, SAMPLE);
    await ingestEvents(memory, SAMPLE);

    const byslug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
    expect((await store.problems.all()).sort(byslug)).toEqual(
      (await memory.problems.all()).sort(byslug),
    );
  });

  it("agrees with the reference implementation about cards, too", async () => {
    // Cards were the gap in this comparison, and the gap was exactly where the two
    // implementations diverged: the in-memory store filters in JavaScript, so it happily
    // returned a card the IndexedDB one had quietly dropped from its index.
    const memory = createMemoryStore();
    const written = [
      card("two-sum", T0 + DAY),
      card("valid-anagram", T0 - DAY),
      card("three-sum", T0 + 5 * DAY, "leetcode"),
    ];
    await store.cards.put(written);
    await memory.cards.put(written);

    const byslug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
    for (const track of ["neetcode", "leetcode"] as const) {
      expect((await store.cards.all(track)).sort(byslug)).toEqual(
        (await memory.cards.all(track)).sort(byslug),
      );
      expect(await store.cards.count(track)).toBe(await memory.cards.count(track));
      expect(await store.cards.countDue(track, T0)).toBe(await memory.cards.countDue(track, T0));
      expect(await store.cards.nextAfter(track, T0)).toEqual(
        await memory.cards.nextAfter(track, T0),
      );
      expect((await store.cards.due(track, T0)).sort(byslug)).toEqual(
        (await memory.cards.due(track, T0)).sort(byslug),
      );
    }
  });

  it("refuses a card that could never be read back", async () => {
    // `NaN` is not a valid index key, so IndexedDB accepts the row and then leaves it out
    // of every read through `[track, due]` — invisible to the queue, the badge and the
    // browse list, while seeding keeps re-creating it because it looks absent.
    const memory = createMemoryStore();
    const broken = [card("two-sum", Number.NaN)];

    await expect(store.cards.put(broken)).rejects.toThrow(/due must be a finite timestamp/);
    await expect(memory.cards.put(broken)).rejects.toThrow(/due must be a finite timestamp/);
    expect(await store.cards.all()).toEqual([]);
    expect(await store.cards.get("neetcode", "two-sum")).toBeUndefined();
  });

  it("counts solved problems per provider on a brand-new database", async () => {
    // A fresh install skips every version block in the upgrade, so an index created only
    // there would be missing on exactly the installs nobody tests by upgrading.
    await ingestEvents(store, SAMPLE);

    expect(await store.problems.countSolved("leetcode")).toBe(2);
    expect(await store.problems.countSolved("neetcode")).toBe(0);
  });

  it("counts and finds cards without loading the track", async () => {
    await store.cards.put([
      card("overdue", T0 - DAY),
      card("due-now", T0),
      card("soon", T0 + DAY),
      card("later", T0 + 3 * DAY),
      card("other-track", T0 - DAY, "leetcode"),
    ]);

    expect(await store.cards.count("neetcode")).toBe(4);
    expect(await store.cards.countDue("neetcode", T0)).toBe(2);
    // The soonest card that isn't due yet — what the panel reports as "next up".
    expect((await store.cards.nextAfter("neetcode", T0))?.slug).toBe("soon");
    expect(await store.cards.nextAfter("leetcode", T0)).toBeUndefined();
  });

  it("applies an import whole, or not at all", async () => {
    await ingestEvents(store, SAMPLE);
    const before = await store.exportSnapshot();

    // One unusable card in an otherwise fine file. Applied record by record, the events
    // and problems ahead of it would already be committed by the time it failed.
    const snapshot = await store.exportSnapshot();
    snapshot.events = [submission("longest-substring", T0 + 9 * DAY, "accepted")];
    snapshot.cards = [card("longest-substring", Number.NaN)];

    await expect(store.importSnapshot(snapshot, "merge")).rejects.toThrow(/due must be/);

    expect(await store.exportSnapshot()).toMatchObject({
      events: before.events,
      problems: before.problems,
      cards: before.cards,
    });
  });

  it("erases one track and leaves the other intact", async () => {
    // The destructive one, so it is checked against the real database rather than only
    // the in-memory reference: every delete here goes through an index scoped to one
    // track, and a range that leaked would take the other site's history with it.
    await ingestEvents(store, [
      ...SAMPLE,
      {
        id: eventId("neetcode", "problem_solved", "two-sum", 0, "completed"),
        type: "problem_solved",
        provider: "neetcode",
        slug: "two-sum",
        solvedAt: T0,
        observedAt: T0,
      },
    ]);
    await store.cards.put([card("two-sum", T0, "neetcode"), card("two-sum", T0, "leetcode")]);
    await store.logs.append([
      log("neetcode", "two-sum", T0),
      log("leetcode", "two-sum", T0 + DAY),
    ]);

    const cleared = await store.clearTrack("leetcode");

    expect(cleared).toEqual({ events: 3, problems: 2, cards: 1, logs: 1 });
    expect(await store.events.count("leetcode")).toBe(0);
    expect(await store.cards.all("leetcode")).toEqual([]);
    expect(await store.problems.all("leetcode")).toEqual([]);
    expect(await store.logs.forProblem("leetcode", "two-sum")).toEqual([]);

    // Everything NeetCode contributed is still there.
    expect(await store.events.count("neetcode")).toBe(1);
    expect(await store.cards.count("neetcode")).toBe(1);
    expect(await store.problems.all("neetcode")).toHaveLength(1);
    expect(await store.logs.forProblem("neetcode", "two-sum")).toHaveLength(1);
  });

  it("rewinds the erased source so its history imports again", async () => {
    await store.settings.patchProvider("leetcode", {
      username: "someone",
      lastFullSyncAt: T0,
      lastIncrementalSyncAt: T0 + DAY,
    });
    await store.settings.patchProvider("neetcode", { lastFullSyncAt: T0 });
    await store.settings.patchTrack("leetcode", { dailyReviewLimit: 42 });

    await store.clearTrack("leetcode");
    const settings = await store.settings.get();

    expect(settings.providers.leetcode).toMatchObject({
      username: null,
      lastFullSyncAt: null,
      lastIncrementalSyncAt: null,
      // Switching a source on or off is a choice, not data, so it survives.
      enabled: true,
    });
    expect(settings.providers.neetcode.lastFullSyncAt).toBe(T0);
    expect(settings.tracks.leetcode.dailyReviewLimit).toBe(42);
  });

  it("agrees with the reference implementation about what a track erase removes", async () => {
    const memory = createMemoryStore();
    const events = [
      ...SAMPLE,
      {
        id: eventId("neetcode", "problem_solved", "two-sum", 0, "completed"),
        type: "problem_solved" as const,
        provider: "neetcode" as const,
        slug: "two-sum",
        solvedAt: T0,
        observedAt: T0,
      },
    ];
    await ingestEvents(store, events);
    await ingestEvents(memory, events);
    const cards = [card("two-sum", T0, "neetcode"), card("two-sum", T0, "leetcode")];
    await store.cards.put(cards);
    await memory.cards.put(cards);

    expect(await store.clearTrack("leetcode")).toEqual(await memory.clearTrack("leetcode"));
    expect(await store.cards.all()).toEqual(await memory.cards.all());
    expect(await store.problems.all()).toEqual(await memory.problems.all());
  });

  it("removes events and problems by key", async () => {
    await ingestEvents(store, SAMPLE);

    const removedEvents = await store.events.remove([SAMPLE[0]!.id, "does-not-exist"]);
    const removedProblems = await store.problems.remove("leetcode", ["two-sum", "never-tracked"]);

    // Only what actually existed is counted, so callers can report honestly.
    expect(removedEvents).toBe(1);
    expect(removedProblems).toBe(1);
    expect(await store.events.count()).toBe(2);
    expect(await store.problems.get("leetcode", "two-sum")).toBeUndefined();
    expect(await store.problems.get("leetcode", "valid-anagram")).toBeDefined();
  });

  it("removing nothing is a no-op", async () => {
    await ingestEvents(store, SAMPLE);

    expect(await store.events.remove([])).toBe(0);
    expect(await store.problems.remove("leetcode", [])).toBe(0);
    expect(await store.events.count()).toBe(3);
  });

  it("clears everything", async () => {
    await ingestEvents(store, SAMPLE);
    await store.settings.update({ activeTrack: "leetcode" });

    await store.clear();

    expect(await store.events.count()).toBe(0);
    expect(await store.problems.all()).toEqual([]);
    expect((await store.settings.get()).activeTrack).toBe("neetcode");
  });
});
