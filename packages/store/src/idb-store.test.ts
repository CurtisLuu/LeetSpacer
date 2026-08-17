import "fake-indexeddb/auto";

import { type ProgressEvent, type ReviewCard, createMemoryStore, eventId, ingestEvents } from "@lcs/core";
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

function card(slug: string, due: number): ReviewCard {
  return {
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

  it("queries events by observation time", async () => {
    await store.events.append(SAMPLE);

    const recent = await store.events.since(T0 + DAY);
    expect(recent.map((e) => e.slug)).toEqual(["valid-anagram"]);
  });

  it("returns due cards in due order, respecting the limit", async () => {
    await store.cards.put([card("c", T0 + 3 * DAY), card("a", T0 + DAY), card("b", T0 + 2 * DAY)]);

    const due = await store.cards.due(T0 + 2 * DAY);
    expect(due.map((c) => c.slug)).toEqual(["a", "b"]);

    const capped = await store.cards.due(T0 + 10 * DAY, 2);
    expect(capped.map((c) => c.slug)).toEqual(["a", "b"]);
  });

  it("round-trips settings with defaults filled in", async () => {
    const updated = await store.settings.update({ seedSpreadDays: 30, dailyNewLimit: 3 });

    expect(updated.seedSpreadDays).toBe(30);
    expect(updated.dailyNewLimit).toBe(3);
    // Untouched fields keep their defaults.
    expect(updated.requestRetention).toBe(0.9);
    expect((await store.settings.get()).seedSpreadDays).toBe(30);
  });

  it("keeps meta keys separate from settings", async () => {
    await store.meta.set("leetcode:cursor", 12345);
    await store.settings.update({ seedSpreadDays: 21 });

    expect(await store.meta.get<number>("leetcode:cursor")).toBe(12345);
    expect((await store.settings.get()).seedSpreadDays).toBe(21);
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
    await store.settings.update({ seedSpreadDays: 7 });

    await store.clear();

    expect(await store.events.count()).toBe(0);
    expect(await store.problems.all()).toEqual([]);
    expect((await store.settings.get()).seedSpreadDays).toBe(14);
  });
});
