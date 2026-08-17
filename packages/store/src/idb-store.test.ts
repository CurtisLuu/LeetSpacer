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
    expect((await restored.problems.get("two-sum"))?.acceptedCount).toBe(1);
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

  it("removes events and problems by key", async () => {
    await ingestEvents(store, SAMPLE);

    const removedEvents = await store.events.remove([SAMPLE[0]!.id, "does-not-exist"]);
    const removedProblems = await store.problems.remove(["two-sum", "never-tracked"]);

    // Only what actually existed is counted, so callers can report honestly.
    expect(removedEvents).toBe(1);
    expect(removedProblems).toBe(1);
    expect(await store.events.count()).toBe(2);
    expect(await store.problems.get("two-sum")).toBeUndefined();
    expect(await store.problems.get("valid-anagram")).toBeDefined();
  });

  it("removing nothing is a no-op", async () => {
    await ingestEvents(store, SAMPLE);

    expect(await store.events.remove([])).toBe(0);
    expect(await store.problems.remove([])).toBe(0);
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
