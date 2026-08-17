import { describe, expect, it } from "vitest";

import { MS_PER_DAY } from "./clock.js";
import type { ReviewCard } from "./model.js";
import { distributeDueDates } from "./seeding.js";

const NOW = 1_786_929_717_000;

function card(slug: string, difficulty: number): ReviewCard {
  return {
    track: "neetcode",
    slug,
    due: NOW + 600_000, // the ~10 minute learning step that makes an import look empty
    stability: 1,
    difficulty,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 1,
    reps: 1,
    lapses: 0,
    phase: "learning",
    lastReview: NOW,
  };
}

const CARDS = [card("easy-one", 2), card("hard-one", 8), card("middling", 5)];

describe("distributeDueDates", () => {
  it("makes everything available immediately under 'now'", () => {
    const result = distributeDueDates(CARDS, { strategy: "now", now: NOW, spreadDays: 14 });

    expect(result.every((c) => c.due === NOW)).toBe(true);
  });

  it("fans cards across the window under 'spread'", () => {
    const result = distributeDueDates(CARDS, { strategy: "spread", now: NOW, spreadDays: 3 });
    const dayOffsets = result.map((c) => (c.due - NOW) / MS_PER_DAY);

    expect(dayOffsets).toEqual([0, 1, 2]);
  });

  it("puts the problems you struggled with first", () => {
    const result = distributeDueDates(CARDS, { strategy: "spread", now: NOW, spreadDays: 3 });

    expect(result.map((c) => c.slug)).toEqual(["hard-one", "middling", "easy-one"]);
  });

  it("never schedules anything beyond the window", () => {
    const many = Array.from({ length: 76 }, (_, i) => card(`p${i}`, i % 10));
    const result = distributeDueDates(many, { strategy: "spread", now: NOW, spreadDays: 14 });

    const maxOffset = Math.max(...result.map((c) => (c.due - NOW) / MS_PER_DAY));
    expect(maxOffset).toBeLessThanOrEqual(14);
    expect(result.filter((c) => c.due === NOW).length).toBeGreaterThan(0);
  });

  it("is stable across runs", () => {
    const options = { strategy: "spread" as const, now: NOW, spreadDays: 5 };

    expect(distributeDueDates(CARDS, options)).toEqual(distributeDueDates(CARDS, options));
  });

  it("leaves FSRS state alone and doesn't mutate the input", () => {
    const before = JSON.parse(JSON.stringify(CARDS));
    const result = distributeDueDates(CARDS, { strategy: "now", now: NOW, spreadDays: 14 });

    expect(CARDS).toEqual(before);
    expect(result[0]).toMatchObject({ stability: expect.any(Number), phase: "learning", reps: 1 });
  });

  it("copes with an empty set and a nonsense window", () => {
    expect(distributeDueDates([], { strategy: "spread", now: NOW, spreadDays: 14 })).toEqual([]);
    expect(
      distributeDueDates(CARDS, { strategy: "spread", now: NOW, spreadDays: 0 }),
    ).toHaveLength(3);
  });
});
