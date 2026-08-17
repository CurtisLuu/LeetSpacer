import { describe, expect, it } from "vitest";

import {
  completedToEvents,
  parseCompletedProblems,
  slugFromLeetcodeUrl,
} from "./progress.js";

const NOW = 1_786_929_717_000;

/** Shaped exactly like a real captured response. */
const TOPICS = {
  "Arrays & Hashing": [
    "https://leetcode.com/problems/contains-duplicate/",
    "https://leetcode.com/problems/valid-anagram/",
  ],
  "Two Pointers": ["https://leetcode.com/problems/3sum/"],
};

describe("slugFromLeetcodeUrl", () => {
  it("pulls the titleSlug out of the forms NeetCode stores", () => {
    expect(slugFromLeetcodeUrl("https://leetcode.com/problems/two-sum/")).toBe("two-sum");
    expect(slugFromLeetcodeUrl("https://leetcode.com/problems/two-sum")).toBe("two-sum");
    expect(slugFromLeetcodeUrl("http://www.leetcode.com/problems/two-sum/description/")).toBe(
      "two-sum",
    );
    expect(slugFromLeetcodeUrl("https://leetcode.com/problems/two-sum/?envType=list")).toBe(
      "two-sum",
    );
  });

  it("returns null for anything that isn't a problem link", () => {
    expect(slugFromLeetcodeUrl("https://neetcode.io/practice")).toBeNull();
    expect(slugFromLeetcodeUrl("")).toBeNull();
  });
});

describe("parseCompletedProblems", () => {
  it("reads the callable-function response shape", () => {
    const parsed = parseCompletedProblems({ data: TOPICS });

    expect(parsed).toEqual([
      { slug: "contains-duplicate", topic: "Arrays & Hashing" },
      { slug: "valid-anagram", topic: "Arrays & Hashing" },
      { slug: "3sum", topic: "Two Pointers" },
    ]);
  });

  it("reads the localStorage cache shape", () => {
    expect(parseCompletedProblems({ completed: TOPICS })).toHaveLength(3);
  });

  it("reads a bare topic map", () => {
    expect(parseCompletedProblems(TOPICS)).toHaveLength(3);
  });

  it("keeps the first topic when a problem is listed under several", () => {
    const parsed = parseCompletedProblems({
      "Arrays & Hashing": ["https://leetcode.com/problems/two-sum/"],
      "Two Pointers": ["https://leetcode.com/problems/two-sum/"],
    });

    expect(parsed).toEqual([{ slug: "two-sum", topic: "Arrays & Hashing" }]);
  });

  it("skips entries that aren't LeetCode problem links", () => {
    const parsed = parseCompletedProblems({
      Graphs: [
        "https://leetcode.com/problems/clone-graph/",
        "https://neetcode.io/problems/something",
        42,
        null,
      ],
    });

    expect(parsed).toEqual([{ slug: "clone-graph", topic: "Graphs" }]);
  });

  it("returns nothing for junk rather than throwing", () => {
    expect(parseCompletedProblems(null)).toEqual([]);
    expect(parseCompletedProblems("nope")).toEqual([]);
    expect(parseCompletedProblems([1, 2, 3])).toEqual([]);
    expect(parseCompletedProblems({ data: null })).toEqual([]);
  });
});

describe("completedToEvents", () => {
  it("marks each problem solved at the moment we first saw it", () => {
    const events = completedToEvents(parseCompletedProblems({ data: TOPICS }), NOW);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "problem_solved",
      provider: "neetcode",
      slug: "contains-duplicate",
      solvedAt: NOW,
    });
  });

  it("uses ids that don't change between syncs", () => {
    // This is what stops a re-sync from minting new events and pushing every solve date
    // forward, which would silently reset the review schedule.
    const first = completedToEvents(parseCompletedProblems({ data: TOPICS }), NOW);
    const later = completedToEvents(parseCompletedProblems({ data: TOPICS }), NOW + 999_999);

    expect(first.map((e) => e.id)).toEqual(later.map((e) => e.id));
  });

  it("gives different problems different ids", () => {
    const events = completedToEvents(parseCompletedProblems({ data: TOPICS }), NOW);

    expect(new Set(events.map((e) => e.id)).size).toBe(3);
  });
});
