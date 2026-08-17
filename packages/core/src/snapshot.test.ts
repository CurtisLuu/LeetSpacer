import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory-store.js";
import type { ProblemState } from "./model.js";
import { parseSnapshot } from "./snapshot.js";

const VALID = {
  version: 2,
  exportedAt: 1_786_929_717_000,
  events: [],
  problems: [],
  cards: [],
  logs: [],
  settings: {},
};

describe("parseSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSnapshot(JSON.stringify(VALID)).version).toBe(2);
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

  it("recognises a capture export and says so", () => {
    const captures = JSON.stringify({ capturedAt: 1, records: [{ id: "x" }] });

    expect(() => parseSnapshot(captures)).toThrow(/capture-mode export/);
  });

  it("reports an unexpected version rather than importing it", () => {
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: 3 }))).toThrow(/found 3/);
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: undefined }))).toThrow(
      /version 1 or 2/,
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
  function problem(slug: string, sources: ProblemState["sources"]): ProblemState {
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
    expect(migrated.version).toBe(2);
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
    expect(migrated.logs).toEqual([
      { id: "leetcode:two-sum:99", track: "leetcode", slug: "two-sum", rating: 3, reviewedAt: 99 },
    ]);
  });
});
