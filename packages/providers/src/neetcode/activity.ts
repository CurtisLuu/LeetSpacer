/**
 * Reading NeetCode's submission history.
 *
 * The completed-problems call answers *whether* a problem is done and nothing else — no
 * dates, no attempts, no failures, and no way to tell a fresh solve from one ticked a year
 * ago. NeetCode does record all of that; it just lives behind the two calls its own
 * activity page uses:
 *
 *   - `getUserStreakData` -> `{ joined, activityByDate: { "YYYY-MM-DD": { count } } }`
 *   - `getUserDailyActivity` with a `date` -> `{ submissions: [...], totalSubmissions,
 *     acceptedCount }`
 *
 * Verified against a live account on 2026-08-17: 58 active days covering 71 of that
 * account's 77 completed problems, 34 of them with more than one submission.
 *
 * The join is exact. Each submission carries `problemId`, which is NeetCode's own slug
 * (`three-integer-sum`), and the bundled slug map already translates those to LeetCode's
 * (`3sum`). No title matching, so no chance of attaching a date to the wrong problem —
 * a slug that doesn't map is dropped rather than guessed at.
 */

import { type ProgressEvent, type Timestamp, eventId } from "@lcs/core";

import { toVerdict } from "../verdict.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Translates a NeetCode slug to LeetCode's, or null when it isn't a problem we know. */
export type ToLeetcodeSlug = (neetcodeSlug: string) => string | null;

export interface StreakData {
  /** ISO date the account was created, if reported. */
  joined: string | null;
  /** `YYYY-MM-DD` for every day with recorded activity, oldest first. */
  activeDates: string[];
}

/** Read `getUserStreakData`. Days with no activity are dropped — there's nothing to fetch. */
export function parseStreakData(raw: unknown): StreakData {
  if (!isRecord(raw)) return { joined: null, activeDates: [] };

  const byDate = isRecord(raw.activityByDate) ? raw.activityByDate : {};
  const activeDates: string[] = [];

  for (const [date, entry] of Object.entries(byDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const count = isRecord(entry) ? entry.count : undefined;
    if (typeof count === "number" && count > 0) activeDates.push(date);
  }

  activeDates.sort();
  return { joined: str(raw.joined), activeDates };
}

/**
 * ISO 8601 with milliseconds, e.g. `2026-08-17T19:49:39.344Z`.
 *
 * Unlike LeetCode's epoch seconds, so it gets its own parser rather than a shared one —
 * feeding an ISO string to a seconds parser yields NaN, and a date we can't read has to
 * drop the record, not invent one.
 */
export function isoToMillis(value: unknown): Timestamp | null {
  const iso = str(value);
  if (!iso) return null;
  const millis = Date.parse(iso);
  if (!Number.isFinite(millis)) return null;
  // Before NeetCode existed means we've misread the field, not that the user is a time
  // traveller.
  return millis < Date.UTC(2015, 0, 1) ? null : millis;
}

/**
 * Identity for a NeetCode submission.
 *
 * The timestamp is the discriminator because NeetCode exposes no submission id.
 * Millisecond precision makes collisions within one problem implausible, and using the
 * submission's own time — rather than when we read it — is what keeps re-syncing the same
 * day idempotent.
 */
export function neetcodeSubmissionEventId(slug: string, submittedAt: Timestamp): string {
  return eventId("neetcode", "submission_result", slug, 0, String(submittedAt));
}

export interface DailyActivity {
  events: ProgressEvent[];
  /** Rows the response held but we couldn't use, by reason. Reported, never silent. */
  skipped: { unmappedSlug: number; undated: number; malformed: number };
}

/**
 * Read one day of `getUserDailyActivity` into submission events.
 *
 * Each row becomes a `submission_result`, the same shape LeetCode's history produces, so
 * the fold derives attempts, accepted counts and real solve dates without knowing which
 * site the events came from.
 */
export function parseDailyActivity(
  raw: unknown,
  toLeetcodeSlug: ToLeetcodeSlug,
  observedAt: Timestamp,
): DailyActivity {
  const skipped = { unmappedSlug: 0, undated: 0, malformed: 0 };
  if (!isRecord(raw) || !Array.isArray(raw.submissions)) return { events: [], skipped };

  const events: ProgressEvent[] = [];

  for (const row of raw.submissions) {
    if (!isRecord(row)) {
      skipped.malformed += 1;
      continue;
    }

    const neetcodeSlug = str(row.problemId);
    if (!neetcodeSlug) {
      skipped.malformed += 1;
      continue;
    }

    const slug = toLeetcodeSlug(neetcodeSlug);
    if (!slug) {
      // A problem outside the bundled map. Dropped rather than keyed by a NeetCode slug,
      // which would show up as a separate, duplicate problem downstream.
      skipped.unmappedSlug += 1;
      continue;
    }

    const submittedAt = isoToMillis(row.timestamp);
    if (submittedAt === null) {
      skipped.undated += 1;
      continue;
    }

    events.push({
      id: neetcodeSubmissionEventId(slug, submittedAt),
      type: "submission_result",
      provider: "neetcode",
      slug,
      verdict: toVerdict(row.status),
      submittedAt,
      observedAt,
    });
  }

  return { events, skipped };
}
