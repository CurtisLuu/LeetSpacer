/**
 * The canonical domain model.
 *
 * Everything here is provider-agnostic: LeetCode and NeetCode both normalize into
 * these shapes, joined on `slug` (the LeetCode `titleSlug`, e.g. "two-sum").
 * Nothing in this package may import browser or extension APIs.
 */

export type ProviderId = "leetcode" | "neetcode";

export const PROVIDER_IDS: readonly ProviderId[] = ["leetcode", "neetcode"];

/**
 * A practice track: one independent review schedule, chosen with the selector in the UI.
 *
 * Deliberately the same values as `ProviderId` — a track *is* a site you practise on, and
 * inventing a parallel vocabulary would only mean mapping between two identical unions.
 * The alias exists because the two mean different things: `ProviderId` answers "where did
 * this fact come from", `TrackId` answers "which schedule does this belong to".
 */
export type TrackId = ProviderId;

export const TRACK_IDS: readonly TrackId[] = ["leetcode", "neetcode"];

export type Difficulty = "Easy" | "Medium" | "Hard";

/** Unix milliseconds. Used everywhere rather than Date, so state is trivially serializable. */
export type Timestamp = number;

// ---------------------------------------------------------------------------
// Catalog (static, shipped with the extension)
// ---------------------------------------------------------------------------

/** A problem as it exists in the world, independent of any user's history. */
export interface Problem {
  /** LeetCode titleSlug — the canonical join key across providers. */
  slug: string;
  /** LeetCode's public question number (`frontendQuestionId`). */
  lcId: number;
  title: string;
  difficulty: Difficulty;
  /** LeetCode topic tag slugs, e.g. ["array", "hash-table"]. */
  topicTags: string[];
  /** Acceptance rate, 0..1. */
  acRate: number;
  isPaidOnly: boolean;
  /** Curated list membership, e.g. ["blind75", "neetcode150"]. */
  lists: string[];
  /** NeetCode roadmap topic this problem belongs to, if any. */
  roadmapTopic: string | null;
  /**
   * Company -> frequency score (0..1). Community-sourced: LeetCode gates real
   * company tags behind Premium, so this is a weighting hint, never a hard filter.
   */
  companyFreq: Record<string, number>;
}

/** A node in the NeetCode roadmap DAG. */
export interface RoadmapTopic {
  id: string;
  title: string;
  /** Topic ids that should be reasonably mastered before this one is recommended. */
  prerequisites: string[];
}

// ---------------------------------------------------------------------------
// Per-user state (derived by folding ProgressEvents)
// ---------------------------------------------------------------------------

export type ProblemStatus = "todo" | "attempted" | "solved";

/**
 * Everything one provider knows about one user's relationship to one problem.
 * This is a *projection* of the event log, never edited directly by adapters.
 *
 * Keyed by `(provider, slug)`, not slug alone: the two sites are kept apart all the way
 * down. LeetCode counting four attempts on a problem says nothing about how it went on
 * NeetCode, and merging the two produced a record that belonged to neither — a solve date
 * from one and an attempt count from the other, seeding both tracks identically.
 */
export interface ProblemState {
  provider: ProviderId;
  slug: string;
  status: ProblemStatus;
  firstSolvedAt: Timestamp | null;
  lastSolvedAt: Timestamp | null;
  /** Total submissions observed, accepted or not. */
  attempts: number;
  /** Accepted submissions observed. */
  acceptedCount: number;
  /**
   * Whether `lastSolvedAt` is a real solve date or just when we first heard about it.
   *
   * True only when a submission with its own timestamp said so. NeetCode reports *that* a
   * problem is done and never when, and LeetCode's accepted-set backfill is dateless too,
   * so both of those leave this false. Seeding reads it to decide whether a card's due
   * date is trustworthy or needs redistributing — without it, a genuinely dated LeetCode
   * card would get its real schedule thrown away and fanned across an arbitrary window.
   */
  hasDatedSolve: boolean;
  /** NeetCode-style per-list checkbox state, keyed by list id. */
  listChecked: Record<string, boolean>;
  updatedAt: Timestamp;
}

export function emptyProblemState(
  provider: ProviderId,
  slug: string,
  at: Timestamp,
): ProblemState {
  return {
    provider,
    slug,
    status: "todo",
    firstSolvedAt: null,
    lastSolvedAt: null,
    attempts: 0,
    acceptedCount: 0,
    hasDatedSolve: false,
    listChecked: {},
    updatedAt: at,
  };
}

// ---------------------------------------------------------------------------
// Spaced repetition
// ---------------------------------------------------------------------------

/** FSRS grades. Mirrors ts-fsrs `Rating` so the P3 scheduler adapter stays thin. */
export const Rating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const;

export type ReviewRating = (typeof Rating)[keyof typeof Rating];

export type CardPhase = "new" | "learning" | "review" | "relearning";

/**
 * FSRS scheduling state for a solved problem. Only solved problems get cards.
 *
 * Identified by `(track, slug)`, not `slug` alone: the two tracks schedule independently,
 * so a problem you've done on both sites carries one card per track and grading it in one
 * leaves the other where it was.
 */
export interface ReviewCard {
  track: TrackId;
  slug: string;
  due: Timestamp;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  /** FSRS learning-step index; carried so cards round-trip through ts-fsrs unchanged. */
  learningSteps: number;
  reps: number;
  lapses: number;
  phase: CardPhase;
  lastReview: Timestamp | null;
}

export interface ReviewLog {
  /** Deterministic: `${track}:${slug}:${reviewedAt}`. */
  id: string;
  track: TrackId;
  slug: string;
  rating: ReviewRating;
  reviewedAt: Timestamp;
  elapsedDays: number;
  scheduledDays: number;
  phase: CardPhase;
  /** Whether the user graded it themselves or we inferred it from submission signals. */
  source: "manual" | "derived";
}

// ---------------------------------------------------------------------------
// Ingest events (append-only)
// ---------------------------------------------------------------------------

export type SubmissionVerdict =
  | "accepted"
  | "wrong_answer"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
  | "runtime_error"
  | "compile_error"
  | "other";

interface BaseEvent {
  /**
   * Deterministic id — the same real-world fact observed twice must produce the
   * same id, so re-syncing is idempotent. Build with `eventId()`.
   */
  id: string;
  provider: ProviderId;
  /** When we observed it (not when it happened). */
  observedAt: Timestamp;
}

export type ProgressEvent =
  | (BaseEvent & { type: "problem_solved"; slug: string; solvedAt: Timestamp })
  | (BaseEvent & { type: "problem_attempted"; slug: string; attemptedAt: Timestamp })
  | (BaseEvent & {
      type: "submission_result";
      slug: string;
      verdict: SubmissionVerdict;
      submittedAt: Timestamp;
    })
  | (BaseEvent & {
      type: "list_checked";
      slug: string;
      list: string;
      checked: boolean;
      changedAt: Timestamp;
    });

export type ProgressEventType = ProgressEvent["type"];

/**
 * Build a deterministic event id. Two syncs that observe the same underlying fact
 * produce identical ids, so `EventStore.append` can dedupe on insert.
 */
/**
 * The identity of a card, flattened to a string.
 *
 * IndexedDB keys cards on the `[track, slug]` pair directly; this is for the places that
 * need a single comparable value — Map keys, the in-memory store, React list keys.
 */
export function cardKey(track: TrackId, slug: string): string {
  return `${track}:${slug}`;
}

/** The identity of a problem state, flattened for Map keys. See `cardKey`. */
export function problemKey(provider: ProviderId, slug: string): string {
  return `${provider}:${slug}`;
}

export function eventId(
  provider: ProviderId,
  type: ProgressEventType,
  slug: string,
  at: Timestamp,
  discriminator = "",
): string {
  const suffix = discriminator ? `:${discriminator}` : "";
  return `${provider}:${type}:${slug}:${at}${suffix}`;
}

/** The moment an event describes, as opposed to when we noticed it. */
export function eventOccurredAt(ev: ProgressEvent): Timestamp {
  switch (ev.type) {
    case "problem_solved":
      return ev.solvedAt;
    case "problem_attempted":
      return ev.attemptedAt;
    case "submission_result":
      return ev.submittedAt;
    case "list_checked":
      return ev.changedAt;
  }
}
