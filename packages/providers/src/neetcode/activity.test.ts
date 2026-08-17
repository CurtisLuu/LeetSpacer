import { describe, expect, it } from "vitest";

import {
  type ToLeetcodeSlug,
  isoToMillis,
  neetcodeSubmissionEventId,
  parseDailyActivity,
  parseStreakData,
} from "./activity.js";

const OBSERVED = Date.UTC(2026, 7, 17);

/** The map the extension supplies, standing in for the bundled slug table. */
const toSlug: ToLeetcodeSlug = (nc) =>
  ({ "three-integer-sum": "3sum", "is-anagram": "valid-anagram" })[nc] ?? null;

/** Shaped exactly as a live account returned it on 2026-08-17. */
function submission(overrides: Record<string, unknown> = {}) {
  return {
    problemId: "three-integer-sum",
    problemName: "3Sum",
    difficulty: "Medium",
    language: "python",
    timestamp: "2026-08-17T19:49:39.344Z",
    v2SubmissionIndex: 0,
    status: "Accepted",
    time: "52 ms",
    memory: "17.1 MB",
    ...overrides,
  };
}

describe("parseStreakData", () => {
  it("returns only the days with activity, oldest first", () => {
    const raw = {
      joined: "2025-11-21",
      currentStreak: 3,
      activityByDate: {
        "2026-08-17": { count: 7, hasActivity: true },
        "2025-11-22": { count: 5, hasActivity: true },
        "2026-01-04": { count: 0, hasActivity: false },
      },
    };

    expect(parseStreakData(raw)).toEqual({
      joined: "2025-11-21",
      // A day with nothing on it is a request that would return nothing.
      activeDates: ["2025-11-22", "2026-08-17"],
    });
  });

  it("ignores keys that aren't dates", () => {
    const raw = { activityByDate: { total: { count: 99 }, "2026-08-17": { count: 1 } } };
    expect(parseStreakData(raw).activeDates).toEqual(["2026-08-17"]);
  });

  it("survives an unexpected body", () => {
    expect(parseStreakData(null)).toEqual({ joined: null, activeDates: [] });
    expect(parseStreakData({})).toEqual({ joined: null, activeDates: [] });
  });
});

describe("isoToMillis", () => {
  it("reads NeetCode's ISO timestamps", () => {
    expect(isoToMillis("2026-08-17T19:49:39.344Z")).toBe(Date.parse("2026-08-17T19:49:39.344Z"));
  });

  it("refuses anything it can't read, rather than inventing a date", () => {
    // Epoch seconds would silently become 1970 if this parsed loosely.
    expect(isoToMillis(1_750_000_000)).toBeNull();
    expect(isoToMillis("not a date")).toBeNull();
    expect(isoToMillis("2001-01-01T00:00:00Z")).toBeNull();
    expect(isoToMillis(null)).toBeNull();
  });
});

describe("parseDailyActivity", () => {
  it("turns a submission into a dated event keyed by LeetCode slug", () => {
    const { events } = parseDailyActivity({ submissions: [submission()] }, toSlug, OBSERVED);

    expect(events).toEqual([
      {
        id: neetcodeSubmissionEventId("3sum", Date.parse("2026-08-17T19:49:39.344Z")),
        type: "submission_result",
        provider: "neetcode",
        slug: "3sum",
        verdict: "accepted",
        submittedAt: Date.parse("2026-08-17T19:49:39.344Z"),
        observedAt: OBSERVED,
      },
    ]);
  });

  it("keeps failures, which is where attempt counts come from", () => {
    const { events } = parseDailyActivity(
      {
        submissions: [
          submission({ status: "Wrong Answer", timestamp: "2026-08-17T19:40:00.000Z" }),
          submission(),
        ],
      },
      toSlug,
      OBSERVED,
    );

    expect(events.map((e) => e.type === "submission_result" && e.verdict)).toEqual([
      "wrong_answer",
      "accepted",
    ]);
  });

  it("is idempotent across re-syncs of the same day", () => {
    const once = parseDailyActivity({ submissions: [submission()] }, toSlug, OBSERVED);
    const twice = parseDailyActivity({ submissions: [submission()] }, toSlug, OBSERVED + 86_400_000);

    expect(once.events[0]!.id).toBe(twice.events[0]!.id);
  });

  it("drops a problem the slug map doesn't know, and says so", () => {
    // Keying it by NeetCode's own slug would surface a duplicate problem downstream.
    const { events, skipped } = parseDailyActivity(
      { submissions: [submission({ problemId: "some-pro-only-problem" })] },
      toSlug,
      OBSERVED,
    );

    expect(events).toEqual([]);
    expect(skipped.unmappedSlug).toBe(1);
  });

  it("drops a row it can't date", () => {
    const { events, skipped } = parseDailyActivity(
      { submissions: [submission({ timestamp: null })] },
      toSlug,
      OBSERVED,
    );

    expect(events).toEqual([]);
    expect(skipped.undated).toBe(1);
  });

  it("counts malformed rows rather than throwing", () => {
    const { events, skipped } = parseDailyActivity(
      { submissions: ["nope", {}, submission()] },
      toSlug,
      OBSERVED,
    );

    expect(events).toHaveLength(1);
    expect(skipped.malformed).toBe(2);
  });

  it("survives an unexpected body", () => {
    expect(parseDailyActivity(null, toSlug, OBSERVED).events).toEqual([]);
    expect(parseDailyActivity({ submissions: "no" }, toSlug, OBSERVED).events).toEqual([]);
  });
});
