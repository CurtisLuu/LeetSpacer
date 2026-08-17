import { describe, expect, it } from "vitest";

import { Rating } from "./model.js";
import { createScheduler, gradeFromAttempts } from "./scheduler.js";

const DAY = 86_400_000;
const NOW = 1_786_929_717_000; // 2026-08-16
const MAY = NOW - 90 * DAY;

const scheduler = createScheduler();

describe("gradeFromAttempts", () => {
  it("treats a clean solve as Good and a struggle as Hard", () => {
    expect(gradeFromAttempts(1)).toBe(Rating.Good);
    expect(gradeFromAttempts(2)).toBe(Rating.Good);
    expect(gradeFromAttempts(3)).toBe(Rating.Hard);
    expect(gradeFromAttempts(7)).toBe(Rating.Hard);
  });

  it("never grades a solved problem as Again", () => {
    for (let attempts = 1; attempts <= 20; attempts++) {
      expect(gradeFromAttempts(attempts)).not.toBe(Rating.Again);
    }
  });
});

describe("seed", () => {
  it("schedules relative to when it was actually solved, not now", () => {
    const card = scheduler.seed("two-sum", MAY, 1);

    expect(card.lastReview).toBe(MAY);
    expect(card.due).toBeGreaterThan(MAY);
    // Solved three months ago with a short first interval — long overdue today.
    expect(card.due).toBeLessThan(NOW);
    expect(scheduler.daysUntilDue(card, NOW)).toBeLessThan(0);
  });

  it("gives a struggled problem a shorter interval than a clean one", () => {
    const clean = scheduler.seed("clean", MAY, 1);
    const struggled = scheduler.seed("struggled", MAY, 5);

    expect(struggled.due - MAY).toBeLessThanOrEqual(clean.due - MAY);
    expect(struggled.difficulty).toBeGreaterThan(clean.difficulty);
  });

  it("produces a card that survives a round trip through review", () => {
    const seeded = scheduler.seed("two-sum", MAY, 1);
    const { card } = scheduler.review(seeded, Rating.Good, NOW);

    expect(card.reps).toBe(seeded.reps + 1);
    expect(card.lastReview).toBe(NOW);
    expect(card.due).toBeGreaterThan(NOW);
  });
});

describe("review", () => {
  it("pushes the next review further out for Easy than for Hard", () => {
    const seeded = scheduler.seed("two-sum", MAY, 1);

    const easy = scheduler.review(seeded, Rating.Easy, NOW).card;
    const hard = scheduler.review(seeded, Rating.Hard, NOW).card;

    expect(easy.due).toBeGreaterThan(hard.due);
  });

  it("brings a forgotten card back within the day", () => {
    const seeded = scheduler.seed("two-sum", MAY, 1);
    const { card } = scheduler.review(seeded, Rating.Again, NOW);

    expect(scheduler.daysUntilDue(card, NOW)).toBeLessThan(1);
  });

  it("counts a lapse and relearns only once the card has matured", () => {
    // FSRS only records a lapse when a card in the review phase is forgotten. A freshly
    // seeded card is still in learning, so it has to graduate first.
    let card = scheduler.seed("two-sum", MAY, 1);
    let at = NOW;
    for (let i = 0; i < 5 && card.phase !== "review"; i++) {
      at = card.due;
      card = scheduler.review(card, Rating.Good, at).card;
    }
    expect(card.phase).toBe("review");

    const forgotten = scheduler.review(card, Rating.Again, card.due).card;

    expect(forgotten.lapses).toBe(card.lapses + 1);
    expect(forgotten.phase).toBe("relearning");
  });

  it("writes a log entry keyed to the review moment", () => {
    const seeded = scheduler.seed("two-sum", MAY, 1);
    const { log } = scheduler.review(seeded, Rating.Good, NOW, "derived");

    expect(log).toMatchObject({
      id: `two-sum:${NOW}`,
      slug: "two-sum",
      rating: Rating.Good,
      reviewedAt: NOW,
      source: "derived",
    });
  });

  it("respects a lower retention target by scheduling less often", () => {
    const relaxed = createScheduler({ requestRetention: 0.7 });
    const strict = createScheduler({ requestRetention: 0.97 });

    const relaxedDue = relaxed.review(relaxed.seed("s", MAY, 1), Rating.Good, NOW).card.due;
    const strictDue = strict.review(strict.seed("s", MAY, 1), Rating.Good, NOW).card.due;

    expect(relaxedDue).toBeGreaterThan(strictDue);
  });
});
