/**
 * Spaced repetition, via FSRS.
 *
 * `ts-fsrs` speaks snake_case and `Date`; the domain model speaks camelCase and
 * millisecond timestamps. That conversion lives here and nowhere else, so the rest of
 * the codebase never imports the scheduling library directly.
 */

import {
  type Card as FsrsCard,
  // `Grade` is `Rating` minus `Manual` — the four values a human can actually give,
  // which is exactly what ReviewRating models.
  type Grade,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";

import type { CardPhase, ReviewCard, ReviewLog, ReviewRating, Timestamp } from "./model.js";

export interface SchedulerOptions {
  /** FSRS target retention, 0..1. Higher means more frequent reviews. */
  requestRetention?: number;
  maximumInterval?: number;
}

const PHASE_BY_STATE: Record<State, CardPhase> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const STATE_BY_PHASE: Record<CardPhase, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function toFsrs(card: ReviewCard): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_BY_PHASE[card.phase],
    last_review: card.lastReview === null ? undefined : new Date(card.lastReview),
  };
}

function fromFsrs(slug: string, card: FsrsCard): ReviewCard {
  return {
    slug,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    phase: PHASE_BY_STATE[card.state],
    lastReview: card.last_review ? card.last_review.getTime() : null,
  };
}

export interface Scheduler {
  /** Apply a grade and return the rescheduled card plus the log entry to persist. */
  review(
    card: ReviewCard,
    rating: ReviewRating,
    now: Timestamp,
    source?: ReviewLog["source"],
  ): { card: ReviewCard; log: ReviewLog };

  /**
   * Build a card for a problem solved in the past, as if it had been reviewed then.
   * This is what turns an import of historical solves into a working review queue —
   * something solved in May is already overdue, and should say so.
   */
  seed(slug: string, solvedAt: Timestamp, attempts: number): ReviewCard;

  /** Days until due; negative means overdue. */
  daysUntilDue(card: ReviewCard, now: Timestamp): number;
}

/**
 * How many submissions it took maps to how well it was known.
 *
 * Deliberately conservative: a solved problem is never graded `Again` (that means you
 * failed to recall it), and a clean first-try solve gets `Good` rather than `Easy`,
 * because `Easy` pushes the next review out far enough to be worth earning explicitly.
 */
export function gradeFromAttempts(attempts: number): ReviewRating {
  return attempts >= 3 ? 2 : 3;
}

export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const engine = fsrs(
    generatorParameters({
      request_retention: options.requestRetention ?? 0.9,
      ...(options.maximumInterval === undefined
        ? {}
        : { maximum_interval: options.maximumInterval }),
    }),
  );

  const scheduler: Scheduler = {
    review(card, rating, now, source = "manual") {
      const { card: next, log } = engine.next(toFsrs(card), new Date(now), rating as Grade);

      return {
        card: fromFsrs(card.slug, next),
        log: {
          id: `${card.slug}:${now}`,
          slug: card.slug,
          rating,
          reviewedAt: now,
          elapsedDays: log.elapsed_days,
          scheduledDays: log.scheduled_days,
          phase: PHASE_BY_STATE[log.state],
          source,
        },
      };
    },

    seed(slug, solvedAt, attempts) {
      const solvedDate = new Date(solvedAt);
      const empty = createEmptyCard(solvedDate);
      const grade = gradeFromAttempts(attempts) as Grade;
      const { card } = engine.next(empty, solvedDate, grade);
      return fromFsrs(slug, card);
    },

    daysUntilDue(card, now) {
      return (card.due - now) / 86_400_000;
    },
  };

  return scheduler;
}
