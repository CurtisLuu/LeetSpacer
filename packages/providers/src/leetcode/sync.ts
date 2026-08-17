/**
 * Driving a LeetCode sync.
 *
 * The transport is injected rather than imported, for two reasons: this package must stay
 * free of browser APIs, and every path below is then testable against recorded responses
 * with no network at all.
 *
 * Two sources, in order of value:
 *
 *   1. `/api/submissions/` — the full submission history, with per-submission timestamps
 *      and verdicts. This is the only thing that gives spaced repetition real solve dates
 *      and honest attempt counts, so it's the primary path.
 *   2. `problemsetQuestionList(filters: {status: AC})` — the complete accepted set, with
 *      no dates. Used to backfill problems the history didn't reach, because LeetCode
 *      truncates long histories and a solved problem missing from the queue is worse than
 *      one with an approximate date.
 *
 * Both run from a content script on leetcode.com against the user's own session, awaiting
 * `ctx.throttle()` before every round trip.
 */

import type { ProgressEvent, Timestamp } from "@lcs/core";

import { ProviderShapeError, type AuthState, type SyncCtx } from "../types.js";
import {
  parseRecentAc,
  parseSolvedPage,
  parseSubmissionPage,
  parseUserStatus,
  solvedToEvents,
} from "./parse.js";
import { RECENT_AC, SOLVED_QUESTIONS, USER_STATUS, submissionsPath } from "./queries.js";

export interface GraphqlOperation {
  readonly operationName: string;
  readonly query: string;
}

/** Same-origin access to leetcode.com. Implemented by the content script. */
export interface LeetcodeTransport {
  graphql(operation: GraphqlOperation, variables?: unknown): Promise<unknown>;
  rest(path: string): Promise<unknown>;
}

/** LeetCode ignores larger values on this endpoint; 20 is what its own UI requests. */
const HISTORY_PAGE_SIZE = 20;
const SOLVED_PAGE_SIZE = 100;

/**
 * ~8,000 submissions. Past this we stop and let the accepted-set backfill cover the rest:
 * a sync that runs for twenty minutes is worse than one that admits it stopped early.
 */
const MAX_HISTORY_PAGES = 400;
const MAX_SOLVED_PAGES = 60;

/** Overlap on incremental syncs, so a submission landing mid-sync isn't skipped. */
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000;

export async function detectAuth(transport: LeetcodeTransport): Promise<AuthState> {
  try {
    return parseUserStatus(await transport.graphql(USER_STATUS));
  } catch {
    return { signedIn: false, reason: "unknown" };
  }
}

/**
 * Page the submission history newest-first, stopping at `stopAt` (or the end).
 *
 * Pagination is by `lastkey`, not offset: LeetCode's offset paging repeats rows once the
 * history is long enough, which would silently under-report attempts.
 */
async function* pageHistory(
  transport: LeetcodeTransport,
  ctx: SyncCtx,
  stopAt: Timestamp | null,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  let lastKey: string | null = null;
  let fetched = 0;

  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    if (ctx.signal?.aborted) return;
    await ctx.throttle();

    const body = await transport.rest(submissionsPath(HISTORY_PAGE_SIZE, lastKey));
    const { events, lastKey: next, hasNext, oldestAt } = parseSubmissionPage(body, ctx.now());

    if (page === 0 && events.length === 0) {
      // An empty first page is ambiguous — a brand-new account, or a shape change. The
      // caller decides; from here it just means there's nothing to yield.
      return;
    }

    if (events.length > 0) {
      fetched += events.length;
      yield events;
      ctx.onProgress?.({ provider: "leetcode", phase: "submissions", fetched, total: null });
    }

    if (!hasNext || !next) return;
    if (stopAt !== null && oldestAt !== null && oldestAt <= stopAt) return;
    lastKey = next;
  }

  ctx.onProgress?.({
    provider: "leetcode",
    phase: "submissions-truncated",
    fetched,
    total: null,
  });
}

/**
 * The complete accepted set, minus anything the history already dated.
 *
 * `skip` slugs that arrived with a real timestamp: emitting a dateless `problem_solved`
 * for them would fold in `observedAt` as a solve date and drag their schedule forward.
 */
async function* pageSolved(
  transport: LeetcodeTransport,
  ctx: SyncCtx,
  skip: ReadonlySet<string>,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  let fetched = 0;

  for (let page = 0; page < MAX_SOLVED_PAGES; page++) {
    if (ctx.signal?.aborted) return;
    await ctx.throttle();

    const body = await transport.graphql(
      SOLVED_QUESTIONS,
      SOLVED_QUESTIONS.variables(page * SOLVED_PAGE_SIZE, SOLVED_PAGE_SIZE),
    );
    const { slugs, total } = parseSolvedPage(body);
    if (slugs.length === 0) return;

    fetched += slugs.length;
    const undated = slugs.filter((slug) => !skip.has(slug));
    if (undated.length > 0) yield solvedToEvents(undated, ctx.now());

    ctx.onProgress?.({ provider: "leetcode", phase: "solved-set", fetched, total });
    if (total !== null && fetched >= total) return;
  }
}

/**
 * Everything LeetCode knows about this user's history.
 *
 * Yields in batches so the caller can persist as it goes — a full sync over a long
 * history takes minutes, and losing all of it because the tab closed at minute nine would
 * be its own bug.
 */
export async function* fullSync(
  transport: LeetcodeTransport,
  ctx: SyncCtx,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  const auth = await detectAuth(transport);
  if (!auth.signedIn) {
    throw new ProviderShapeError("leetcode", "Not signed in to leetcode.com.");
  }

  const dated = new Set<string>();
  let sawHistory = false;

  for await (const batch of pageHistory(transport, ctx, null)) {
    sawHistory = true;
    for (const event of batch) dated.add(event.slug);
    yield batch;
  }

  if (!sawHistory) {
    // The history endpoint gave nothing. Fall back to the profile query before concluding
    // the account is empty — it's the same data LeetCode's own profile page shows.
    for (const event of await recentAccepted(transport, ctx, auth.username)) {
      dated.add(event.slug);
      yield [event];
    }
  }

  // The backfill is a nicety and must not be able to fail the sync. History is the part
  // worth having, it's already been yielded, and a full sync reported as failed would be
  // retried from scratch on the next page load — walking the whole history again for the
  // sake of a query that is broken either way.
  try {
    yield* pageSolved(transport, ctx, dated);
  } catch (cause) {
    ctx.onProgress?.({
      provider: "leetcode",
      phase: `solved-set-unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      fetched: 0,
      total: null,
    });
  }
}

/**
 * Only what changed since `since`.
 *
 * The default path, cheap enough to run whenever a leetcode.com tab is open: for most
 * users this is a single request that comes back with nothing new.
 */
export async function* incrementalSync(
  transport: LeetcodeTransport,
  ctx: SyncCtx,
  since: Timestamp,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  const stopAt = Math.max(0, since - INCREMENTAL_OVERLAP_MS);
  let sawHistory = false;

  for await (const batch of pageHistory(transport, ctx, stopAt)) {
    sawHistory = true;
    // Re-yielding an already-seen submission is free — event ids are deterministic, so
    // the store dedupes on insert. Filtering here would only risk dropping a real one.
    yield batch;
  }

  if (sawHistory) return;

  const auth = await detectAuth(transport);
  if (!auth.signedIn) return;
  const recent = await recentAccepted(transport, ctx, auth.username);
  if (recent.length > 0) yield recent;
}

/** The profile page's accepted feed. Capped by LeetCode at 20, hence fallback-only. */
async function recentAccepted(
  transport: LeetcodeTransport,
  ctx: SyncCtx,
  username: string,
): Promise<ProgressEvent[]> {
  if (ctx.signal?.aborted) return [];
  await ctx.throttle();
  try {
    const body = await transport.graphql(RECENT_AC, RECENT_AC.variables(username, 20));
    return parseRecentAc(body, ctx.now());
  } catch {
    return [];
  }
}
