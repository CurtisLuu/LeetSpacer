/**
 * What a record has to look like before it is allowed into the store.
 *
 * Two jobs, and they are the same job seen from two sides:
 *
 *   - **Untrusted input.** An imported JSON file is a stranger. `parseSnapshot` used to
 *     check that four keys were arrays and then cast, which let every field inside
 *     through unexamined — including a `due` of `null` or `"soon"`.
 *   - **Our own bugs.** A card whose `due` is `NaN` is worse than a rejected one: the
 *     `[track, due]` index refuses an invalid key, so IndexedDB skips the record
 *     silently. The card is then invisible to the queue, the badge and the browse list,
 *     while still being returned by `get` and by export — so seeding sees it missing and
 *     re-creates it on every sync, for ever. A loud throw at the write is the cheap end
 *     of that.
 *
 * The track and provider checks are the same rule from the other direction: a record
 * whose `track` is neither `"leetcode"` nor `"neetcode"` belongs to no schedule and can
 * never be read back by either one. There is no third app to put it in.
 */

import {
  CARD_PHASES,
  PROBLEM_STATUSES,
  PROVIDER_IDS,
  type ProblemState,
  type ProgressEvent,
  type ProviderId,
  RATINGS,
  type ReviewCard,
  type ReviewLog,
  TRACK_IDS,
  type TrackId,
} from "./model.js";

export function isTrackId(value: unknown): value is TrackId {
  return typeof value === "string" && (TRACK_IDS as readonly string[]).includes(value);
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Rejected as a value, not just as a type.
 *
 * `NaN` and `Infinity` are numbers as far as `typeof` is concerned and invalid as
 * IndexedDB keys, which is the whole failure mode above.
 */
function isFinite_(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullOrFinite(value: unknown): value is number | null {
  return value === null || isFinite_(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Thrown when a record can't be stored. Carries what was wrong, for the import message. */
export class InvalidRecordError extends Error {
  constructor(
    readonly kind: string,
    readonly reason: string,
  ) {
    super(`Invalid ${kind}: ${reason}`);
    this.name = "InvalidRecordError";
  }
}

function reject(kind: string, reason: string): never {
  throw new InvalidRecordError(kind, reason);
}

/** Short, quotable identification for an error message. */
function nameOf(value: unknown, keys: readonly string[]): string {
  if (!isRecord(value)) return typeof value;
  const parts = keys.map((key) => `${key}=${JSON.stringify(value[key])}`);
  return parts.join(" ");
}

export function validateCard(value: unknown): ReviewCard {
  const kind = "review card";
  if (!isRecord(value)) reject(kind, `expected an object, found ${typeof value}`);

  const at = nameOf(value, ["track", "slug"]);
  if (!isTrackId(value.track)) reject(kind, `${at} — track must be "leetcode" or "neetcode"`);
  if (!isSlug(value.slug)) reject(kind, `${at} — slug must be a non-empty string`);
  // The one that used to disappear. Named on its own because "invalid card" would send
  // whoever hits it looking at the wrong field.
  if (!isFinite_(value.due)) {
    reject(kind, `${at} — due must be a finite timestamp, found ${JSON.stringify(value.due)}`);
  }
  for (const key of [
    "stability",
    "difficulty",
    "elapsedDays",
    "scheduledDays",
    "learningSteps",
    "reps",
    "lapses",
  ] as const) {
    if (!isFinite_(value[key])) reject(kind, `${at} — ${key} must be a finite number`);
  }
  if (!(CARD_PHASES as readonly unknown[]).includes(value.phase)) {
    reject(kind, `${at} — phase must be one of ${CARD_PHASES.join(", ")}`);
  }
  if (!isNullOrFinite(value.lastReview)) reject(kind, `${at} — lastReview must be a time or null`);

  return value as unknown as ReviewCard;
}

export function validateProblemState(value: unknown): ProblemState {
  const kind = "problem";
  if (!isRecord(value)) reject(kind, `expected an object, found ${typeof value}`);

  const at = nameOf(value, ["provider", "slug"]);
  if (!isProviderId(value.provider)) {
    reject(kind, `${at} — provider must be "leetcode" or "neetcode"`);
  }
  if (!isSlug(value.slug)) reject(kind, `${at} — slug must be a non-empty string`);
  if (!(PROBLEM_STATUSES as readonly unknown[]).includes(value.status)) {
    reject(kind, `${at} — status must be one of ${PROBLEM_STATUSES.join(", ")}`);
  }
  if (!isNullOrFinite(value.firstSolvedAt)) reject(kind, `${at} — firstSolvedAt`);
  if (!isNullOrFinite(value.lastSolvedAt)) reject(kind, `${at} — lastSolvedAt`);
  if (!isFinite_(value.attempts)) reject(kind, `${at} — attempts must be a finite number`);
  if (!isFinite_(value.acceptedCount)) reject(kind, `${at} — acceptedCount must be a finite number`);
  if (typeof value.hasDatedSolve !== "boolean") reject(kind, `${at} — hasDatedSolve must be a boolean`);
  if (!isRecord(value.listChecked)) reject(kind, `${at} — listChecked must be an object`);
  if (!isFinite_(value.updatedAt)) reject(kind, `${at} — updatedAt must be a finite timestamp`);

  return value as unknown as ProblemState;
}

const EVENT_TIMESTAMP: Record<string, string> = {
  problem_solved: "solvedAt",
  problem_attempted: "attemptedAt",
  submission_result: "submittedAt",
  list_checked: "changedAt",
};

export function validateEvent(value: unknown): ProgressEvent {
  const kind = "event";
  if (!isRecord(value)) reject(kind, `expected an object, found ${typeof value}`);

  const at = nameOf(value, ["id"]);
  if (!isSlug(value.id)) reject(kind, `${at} — id must be a non-empty string`);
  if (!isProviderId(value.provider)) {
    reject(kind, `${at} — provider must be "leetcode" or "neetcode"`);
  }
  if (!isSlug(value.slug)) reject(kind, `${at} — slug must be a non-empty string`);
  if (!isFinite_(value.observedAt)) reject(kind, `${at} — observedAt must be a finite timestamp`);

  const timestampKey = typeof value.type === "string" ? EVENT_TIMESTAMP[value.type] : undefined;
  if (timestampKey === undefined) reject(kind, `${at} — unknown type ${JSON.stringify(value.type)}`);
  if (!isFinite_(value[timestampKey])) {
    reject(kind, `${at} — ${timestampKey} must be a finite timestamp`);
  }
  if (value.type === "list_checked") {
    if (!isSlug(value.list)) reject(kind, `${at} — list must be a non-empty string`);
    if (typeof value.checked !== "boolean") reject(kind, `${at} — checked must be a boolean`);
  }

  return value as unknown as ProgressEvent;
}

export function validateLog(value: unknown): ReviewLog {
  const kind = "review log";
  if (!isRecord(value)) reject(kind, `expected an object, found ${typeof value}`);

  const at = nameOf(value, ["id"]);
  if (!isSlug(value.id)) reject(kind, `${at} — id must be a non-empty string`);
  if (!isTrackId(value.track)) reject(kind, `${at} — track must be "leetcode" or "neetcode"`);
  if (!isSlug(value.slug)) reject(kind, `${at} — slug must be a non-empty string`);
  if (!(RATINGS as readonly unknown[]).includes(value.rating)) {
    reject(kind, `${at} — rating must be one of ${RATINGS.join(", ")}`);
  }
  if (!isFinite_(value.reviewedAt)) reject(kind, `${at} — reviewedAt must be a finite timestamp`);
  if (!isFinite_(value.elapsedDays)) reject(kind, `${at} — elapsedDays must be a finite number`);
  if (!isFinite_(value.scheduledDays)) reject(kind, `${at} — scheduledDays must be a finite number`);
  if (!(CARD_PHASES as readonly unknown[]).includes(value.phase)) {
    reject(kind, `${at} — phase must be one of ${CARD_PHASES.join(", ")}`);
  }
  if (value.source !== "manual" && value.source !== "derived") {
    reject(kind, `${at} — source must be "manual" or "derived"`);
  }

  return value as unknown as ReviewLog;
}

/** Validate a whole list, naming the position of the first bad one. */
export function validateAll<T>(values: readonly unknown[], validate: (value: unknown) => T): T[] {
  return values.map((value, index) => {
    try {
      return validate(value);
    } catch (cause) {
      if (cause instanceof InvalidRecordError) {
        throw new InvalidRecordError(cause.kind, `at position ${index}, ${cause.reason}`);
      }
      throw cause;
    }
  });
}
