import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory-store.js";
import type { ProviderId } from "./model.js";
import { parseSnapshot } from "./snapshot.js";

const VALID = {
  version: 3,
  exportedAt: 1_786_929_717_000,
  events: [],
  problems: [],
  cards: [],
  logs: [],
  settings: {},
};

describe("parseSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSnapshot(JSON.stringify(VALID)).version).toBe(3);
  });

  it("round-trips what the store exports", async () => {
    const store = createMemoryStore();
    const exported = await store.exportSnapshot();

    expect(() => parseSnapshot(JSON.stringify(exported))).not.toThrow();
  });

  it("names the problem when the file isn't JSON", () => {
    expect(() => parseSnapshot("not json at all")).toThrow(/isn't valid JSON/);
  });

  it("rejects JSON that isn't an object", () => {
    expect(() => parseSnapshot("[1,2,3]")).toThrow(/isn't an object/);
    expect(() => parseSnapshot("42")).toThrow(/isn't an object/);
  });

  it("recognises a debug capture and says so", () => {
    const captures = JSON.stringify({ capturedAt: 1, records: [{ id: "x" }] });

    expect(() => parseSnapshot(captures)).toThrow(/debug capture/);
  });

  it("reports an unexpected version rather than importing it", () => {
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: 4 }))).toThrow(/found 4/);
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: undefined }))).toThrow(
      /version 1, 2 or 3/,
    );
  });

  it("requires each list to be present", () => {
    for (const key of ["events", "problems", "cards", "logs"]) {
      const broken = JSON.stringify({ ...VALID, [key]: undefined });
      expect(() => parseSnapshot(broken)).toThrow(new RegExp(`"${key}"`));
    }
  });
});

describe("migrating a version 1 backup", () => {
  /** Shaped as version 1 stored it, which is the only thing the migration ever sees. */
  function problem(slug: string, sources: ProviderId[]) {
    return {
      slug,
      status: "solved",
      firstSolvedAt: 1,
      lastSolvedAt: 1,
      attempts: 1,
      acceptedCount: 1,
      sources,
      hasDatedSolve: false,
      listChecked: {},
      updatedAt: 1,
    };
  }

  const legacy = {
    version: 1,
    exportedAt: 1_786_929_717_000,
    events: [],
    problems: [problem("two-sum", ["leetcode"]), problem("is-anagram", ["neetcode"])],
    cards: [
      { slug: "two-sum", due: 10, reps: 3 },
      { slug: "is-anagram", due: 20, reps: 1 },
      { slug: "orphan", due: 30, reps: 0 },
    ],
    logs: [{ id: "two-sum:99", slug: "two-sum", rating: 3, reviewedAt: 99 }],
    settings: {},
  };

  const migrated = parseSnapshot(JSON.stringify(legacy));

  it("reports itself as the current version", () => {
    expect(migrated.version).toBe(3);
  });

  it("routes each card by where its problem's evidence came from", () => {
    const byslug = new Map(migrated.cards.map((card) => [card.slug, card]));

    expect(byslug.get("two-sum")?.track).toBe("leetcode");
    expect(byslug.get("is-anagram")?.track).toBe("neetcode");
  });

  it("sends a card with no known problem to NeetCode", () => {
    // The only working data path before the LeetCode adapter existed, so an unattributed
    // card almost certainly came from there.
    expect(migrated.cards.find((card) => card.slug === "orphan")?.track).toBe("neetcode");
  });

  it("preserves every schedule rather than dropping or duplicating one", () => {
    expect(migrated.cards).toHaveLength(3);
    expect(migrated.cards.map((card) => card.due).sort((a, b) => a - b)).toEqual([10, 20, 30]);
  });

  it("re-keys logs so two tracks can't collide on one id", () => {
    expect(migrated.logs).toHaveLength(1);
    expect(migrated.logs[0]).toMatchObject({
      id: "leetcode:two-sum:99",
      track: "leetcode",
      slug: "two-sum",
      rating: 3,
      reviewedAt: 99,
    });
  });

  it("fills in scheduling fields the old format didn't carry", () => {
    // A backup made before these fields existed still has to import. The migration adds
    // them; it never overwrites one the file did carry.
    const twoSum = migrated.cards.find((card) => card.slug === "two-sum");

    expect(twoSum).toMatchObject({ due: 10, reps: 3, phase: "review", lapses: 0, lastReview: null });
    expect(Number.isFinite(twoSum?.stability)).toBe(true);
    // Never reviewed, so it is a new card rather than one in the review phase.
    expect(migrated.cards.find((card) => card.slug === "orphan")?.phase).toBe("new");
    expect(migrated.logs[0]).toMatchObject({ source: "manual", phase: "review" });
  });

  it("refuses a card whose due date the file never had", () => {
    // The one field a migration must not invent: a made-up due date is a made-up
    // schedule, and it would look exactly like a real one.
    const broken = JSON.stringify({
      ...legacy,
      cards: [{ slug: "two-sum", reps: 1 }],
    });

    expect(() => parseSnapshot(broken)).toThrow(/due must be a finite timestamp/);
  });
});
