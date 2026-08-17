import { describe, expect, it } from "vitest";

import { ingestEvents, rebuildFromLog } from "./ingest.js";
import { createMemoryStore } from "./memory-store.js";
import { type ProgressEvent, eventId } from "./model.js";

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

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

describe("ingestEvents", () => {
  it("persists new events and the state they imply", async () => {
    const store = createMemoryStore();

    const result = await ingestEvents(store, [
      submission("two-sum", T0, "wrong_answer"),
      submission("two-sum", T0 + 60_000, "accepted"),
    ]);

    expect(result).toEqual({ received: 2, inserted: 2, updatedProblems: ["two-sum"] });
    expect((await store.problems.get("two-sum"))?.status).toBe("solved");
    expect(await store.events.count()).toBe(2);
  });

  it("is idempotent — re-syncing the same events changes nothing", async () => {
    const store = createMemoryStore();
    const events = [
      submission("two-sum", T0, "wrong_answer"),
      submission("two-sum", T0 + 60_000, "accepted"),
    ];

    await ingestEvents(store, events);
    const before = await store.problems.get("two-sum");

    const second = await ingestEvents(store, events);

    expect(second.inserted).toBe(0);
    expect(second.updatedProblems).toEqual([]);
    expect(await store.problems.get("two-sum")).toEqual(before);
    expect(await store.events.count()).toBe(2);
  });

  it("folds only the delta onto existing state across separate syncs", async () => {
    const store = createMemoryStore();

    await ingestEvents(store, [submission("two-sum", T0, "wrong_answer")]);
    await ingestEvents(store, [
      submission("two-sum", T0, "wrong_answer"), // already seen
      submission("two-sum", T0 + DAY, "accepted"), // new
    ]);

    const state = await store.problems.get("two-sum");
    expect(state?.attempts).toBe(2);
    expect(state?.acceptedCount).toBe(1);
  });
});

describe("rebuildFromLog", () => {
  it("reconstructs identical state from the event log alone", async () => {
    const store = createMemoryStore();
    await ingestEvents(store, [
      submission("two-sum", T0, "wrong_answer"),
      submission("two-sum", T0 + DAY, "accepted"),
      submission("valid-anagram", T0 + 2 * DAY, "accepted"),
    ]);

    const before = (await store.problems.all()).sort((a, b) => a.slug.localeCompare(b.slug));

    // Corrupt the projection, then rebuild it from the log.
    await store.problems.put([{ ...before[0]!, status: "todo", attempts: 0, acceptedCount: 0 }]);
    const count = await rebuildFromLog(store);

    const after = (await store.problems.all()).sort((a, b) => a.slug.localeCompare(b.slug));
    expect(count).toBe(2);
    expect(after).toEqual(before);
  });
});
