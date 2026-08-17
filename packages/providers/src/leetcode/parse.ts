/**
 * Turning LeetCode's responses into domain events.
 *
 * Everything here is pure: give it a parsed JSON body, get back events or null. No
 * network, no clock, no browser. That's what makes the adapter testable against recorded
 * fixtures, which matters more than usual because LeetCode's response shapes are
 * unversioned and change without notice.
 *
 * The guiding rule is that an unexpected shape yields *nothing*, never a wrong guess: a
 * missing field drops that one record rather than poisoning the event log with a bogus
 * timestamp. Real solve dates are the whole point of reading LeetCode, so a fabricated
 * one is worse than none.
 */

import {
  type ProgressEvent,
  type SubmissionVerdict,
  type Timestamp,
  eventId,
} from "@lcs/core";

import type { AuthState } from "../types.js";
import { toVerdict } from "../verdict.js";

export { toVerdict };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** LeetCode returns epoch *seconds*, sometimes as a string. Milliseconds, or null. */
export function toMillis(value: unknown): Timestamp | null {
  const seconds =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // A plausibility gate: anything before LeetCode existed, or in the future, is a shape
  // change we've misread rather than a real submission.
  const millis = seconds * 1000;
  if (millis < Date.UTC(2010, 0, 1)) return null;
  return millis;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Read `globalData` -> `userStatus`. Anything unrecognized reads as signed out. */
export function parseUserStatus(raw: unknown): AuthState {
  const status = isRecord(raw) && isRecord(raw.data) ? raw.data.userStatus : undefined;
  if (!isRecord(status)) return { signedIn: false, reason: "unknown" };

  const username = str(status.username);
  if (status.isSignedIn !== true || !username) return { signedIn: false, reason: "no-session" };
  return { signedIn: true, username };
}

// ---------------------------------------------------------------------------
// The accepted-problem set (no dates)
// ---------------------------------------------------------------------------

export interface SolvedPage {
  slugs: string[];
  /** How many the server says match the filter, for progress reporting. */
  total: number | null;
}

/** Read one page of `problemsetQuestionList` filtered to `status: AC`. */
export function parseSolvedPage(raw: unknown): SolvedPage {
  const list =
    isRecord(raw) && isRecord(raw.data) ? raw.data.problemsetQuestionList : undefined;
  if (!isRecord(list) || !Array.isArray(list.questions)) return { slugs: [], total: null };

  const slugs: string[] = [];
  for (const question of list.questions) {
    if (!isRecord(question)) continue;
    // The filter is server-side, but trust it only when the row agrees: a signed-out
    // request returns the same shape with `status: null` for everything.
    if (question.status !== "ac" && question.status !== "AC") continue;
    const slug = str(question.titleSlug);
    if (slug) slugs.push(slug);
  }

  return { slugs, total: typeof list.total === "number" ? list.total : null };
}

/**
 * Events for problems known to be solved but with no date attached.
 *
 * The id deliberately omits any timestamp — same reasoning as NeetCode's completed set.
 * If it included `observedAt`, every sync would mint a new event and keep pushing the
 * solve date forward, resetting the review schedule each time.
 */
export function solvedToEvents(
  slugs: readonly string[],
  observedAt: Timestamp,
): ProgressEvent[] {
  return slugs.map((slug) => ({
    id: eventId("leetcode", "problem_solved", slug, 0, "ac-list"),
    type: "problem_solved",
    provider: "leetcode",
    slug,
    solvedAt: observedAt,
    observedAt,
  }));
}

// ---------------------------------------------------------------------------
// Submission history (the dated path)
// ---------------------------------------------------------------------------

/**
 * Identity for a submission event.
 *
 * Keyed on LeetCode's submission id alone, with the timestamp deliberately left out. The
 * same submission is seen twice by design — once live, as the judge returns its verdict,
 * and again later when a history sync walks past it — and the two disagree about the
 * exact moment it happened. Putting the timestamp in the id would make them two different
 * events, and the fold would count the attempt twice.
 *
 * Submission ids are globally unique and permanent, so this also makes re-syncing the
 * same history insert nothing at all.
 */
export function submissionEventId(slug: string, submissionId: string): string {
  return eventId("leetcode", "submission_result", slug, 0, submissionId);
}

export interface SubmissionPage {
  events: ProgressEvent[];
  /** Cursor for the next page; null when LeetCode says there isn't one. */
  lastKey: string | null;
  hasNext: boolean;
  /** The oldest submission on this page, for deciding when an incremental sync can stop. */
  oldestAt: Timestamp | null;
}

/**
 * Read one page of `/api/submissions/`.
 *
 * Each row becomes a `submission_result`, which is the richest event we can emit: the
 * fold derives attempts, accepted count, and first/last solved dates from it, so a
 * separate `problem_solved` would only double-count.
 */
export function parseSubmissionPage(raw: unknown, observedAt: Timestamp): SubmissionPage {
  if (!isRecord(raw) || !Array.isArray(raw.submissions_dump)) {
    return { events: [], lastKey: null, hasNext: false, oldestAt: null };
  }

  const events: ProgressEvent[] = [];
  let oldestAt: Timestamp | null = null;

  for (const row of raw.submissions_dump) {
    if (!isRecord(row)) continue;

    const slug = str(row.title_slug);
    const submittedAt = toMillis(row.timestamp);
    // Without both, the row can't be keyed or dated, and a submission we can't date is
    // exactly the thing this adapter exists to avoid inventing.
    if (!slug || submittedAt === null) continue;

    const submissionId = str(row.id) ?? String(row.id ?? "");
    if (!submissionId) continue;

    events.push({
      id: submissionEventId(slug, submissionId),
      type: "submission_result",
      provider: "leetcode",
      slug,
      verdict: toVerdict(row.status_display, row.status),
      submittedAt,
      observedAt,
    });

    oldestAt = oldestAt === null ? submittedAt : Math.min(oldestAt, submittedAt);
  }

  return {
    events,
    lastKey: str(raw.last_key),
    hasNext: raw.has_next === true,
    oldestAt,
  };
}

// ---------------------------------------------------------------------------
// Recent accepted submissions (GraphQL delta)
// ---------------------------------------------------------------------------

/** Read `recentAcSubmissionList`. Accepted-only by definition, hence `problem_solved`. */
export function parseRecentAc(raw: unknown, observedAt: Timestamp): ProgressEvent[] {
  const list =
    isRecord(raw) && isRecord(raw.data) ? raw.data.recentAcSubmissionList : undefined;
  if (!Array.isArray(list)) return [];

  const events: ProgressEvent[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const slug = str(row.titleSlug);
    const solvedAt = toMillis(row.timestamp);
    if (!slug || solvedAt === null) continue;

    const submissionId = str(row.id) ?? String(row.id ?? "");
    events.push({
      id: submissionEventId(slug, submissionId),
      type: "submission_result",
      provider: "leetcode",
      slug,
      verdict: "accepted",
      submittedAt: solvedAt,
      observedAt,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Live submission result (observed from an open tab)
// ---------------------------------------------------------------------------

export interface SubmissionCheck {
  verdict: SubmissionVerdict;
  /** LeetCode polls until this is true; earlier responses are "PENDING"/"STARTED". */
  finished: boolean;
}

const CHECK_URL = /\/submissions\/detail\/(\d+)\/check\/?/;

/** Does this URL look like the poll LeetCode runs while a submission is judged? */
export function isSubmissionCheckUrl(url: string): boolean {
  return CHECK_URL.test(url);
}

/** The submission id from the poll URL — the body doesn't carry one. */
export function submissionIdFromCheckUrl(url: string): string | null {
  return CHECK_URL.exec(url)?.[1] ?? null;
}

/**
 * Read the judge poll's response.
 *
 * The body carries no slug — the page URL is what identifies the problem, so the caller
 * pairs this with `slugFromProblemUrl(location.href)`.
 */
export function parseSubmissionCheck(raw: unknown): SubmissionCheck | null {
  if (!isRecord(raw)) return null;
  if (raw.state !== "SUCCESS") return null;

  const display = str(raw.status_msg);
  if (!display && typeof raw.status_code !== "number") return null;

  return { verdict: toVerdict(raw.status_msg, raw.status_code), finished: true };
}

/** The titleSlug from any leetcode.com problem URL, including its sub-tabs. */
export function slugFromProblemUrl(url: string): string | null {
  return /leetcode\.com\/problems\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * A judged submission, observed live.
 *
 * `observedAt` doubles as the submission time here, which is honest: we saw the verdict
 * within a second or two of it being handed down. It shares an id with the row a later
 * history sync will read for the same submission, so only one of them lands.
 */
export function checkToEvent(
  check: SubmissionCheck,
  slug: string,
  submissionId: string,
  observedAt: Timestamp,
): ProgressEvent {
  return {
    id: submissionEventId(slug, submissionId),
    type: "submission_result",
    provider: "leetcode",
    slug,
    verdict: check.verdict,
    submittedAt: observedAt,
    observedAt,
  };
}
