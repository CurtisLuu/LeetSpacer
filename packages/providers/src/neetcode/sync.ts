/**
 * Driving a NeetCode submission sync.
 *
 * Same shape as the LeetCode driver: the transport is injected, so the walk is testable
 * in Node with no network, and every round trip goes through `ctx.throttle()`.
 *
 * The walk is cheap to bound because `getUserStreakData` names exactly which days had
 * activity — there's no paging and no guessing, just one call per active day.
 */

import type { ProgressEvent, Timestamp } from "@lcs/core";

import type { SyncCtx } from "../types.js";
import { type ToLeetcodeSlug, parseDailyActivity, parseStreakData } from "./activity.js";

/** Same-origin access to neetcode.io's callable endpoint. */
export interface NeetcodeTransport {
  callable(functionId: string, extra?: Record<string, unknown>): Promise<unknown>;
}

/**
 * A year and a half of daily practice. Past this the walk stops and says so rather than
 * running for ten minutes; the completed-set path still covers everything either way.
 */
const MAX_DAYS = 600;

/** `YYYY-MM-DD` in UTC, which is the key space `activityByDate` uses. */
function toDateKey(at: Timestamp): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Walk NeetCode's activity, newest day first, stopping at `stopAt` (or the start).
 *
 * Newest first so an incremental sync can stop as soon as it reaches known ground, and so
 * a full sync that gets interrupted has still recorded the most recent work.
 */
async function* walk(
  transport: NeetcodeTransport,
  ctx: NeetcodeSyncCtx,
  stopAt: Timestamp | null,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  await ctx.throttle();
  const { activeDates } = parseStreakData(await transport.callable("getUserStreakData"));
  if (activeDates.length === 0) return;

  const stopKey = stopAt === null ? null : toDateKey(stopAt);
  // The day containing `stopAt` is re-read rather than skipped: it may have gained
  // submissions since, and deterministic event ids make re-reading free.
  const wanted = [...activeDates].reverse().filter((date) => stopKey === null || date >= stopKey);

  ctx.onProgress?.({
    provider: "neetcode",
    phase: "activity",
    fetched: 0,
    total: wanted.length,
  });

  const skipped = { unmappedSlug: 0, undated: 0, malformed: 0 };
  let fetched = 0;

  for (const date of wanted.slice(0, MAX_DAYS)) {
    if (ctx.signal?.aborted) return;
    await ctx.throttle();

    let day: unknown;
    try {
      day = await transport.callable("getUserDailyActivity", { date });
    } catch {
      // One bad day shouldn't end the walk — the rest of the history is still worth
      // having, and the next sync will retry this date.
      continue;
    }

    const parsed = parseDailyActivity(day, ctx.toLeetcodeSlug, ctx.now());
    skipped.unmappedSlug += parsed.skipped.unmappedSlug;
    skipped.undated += parsed.skipped.undated;
    skipped.malformed += parsed.skipped.malformed;

    fetched += 1;
    if (parsed.events.length > 0) yield parsed.events;
    ctx.onProgress?.({
      provider: "neetcode",
      phase: "activity",
      fetched,
      total: wanted.length,
    });
  }

  // Silence about dropped rows would read as full coverage. Reported once, at the end.
  const dropped = skipped.unmappedSlug + skipped.undated + skipped.malformed;
  if (dropped > 0) {
    ctx.onProgress?.({
      provider: "neetcode",
      phase:
        `skipped ${dropped} submissions ` +
        `(${skipped.unmappedSlug} unmapped slug, ${skipped.undated} undated, ` +
        `${skipped.malformed} malformed)`,
      fetched,
      total: wanted.length,
    });
  }

  if (wanted.length > MAX_DAYS) {
    ctx.onProgress?.({
      provider: "neetcode",
      phase: `activity-truncated at ${MAX_DAYS} days`,
      fetched,
      total: wanted.length,
    });
  }
}

/** Every day NeetCode has recorded activity for. */
export function fullSync(
  transport: NeetcodeTransport,
  ctx: NeetcodeSyncCtx,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  return walk(transport, ctx, null);
}

/** Only days at or after `since`. Usually one call plus today. */
export function incrementalSync(
  transport: NeetcodeTransport,
  ctx: NeetcodeSyncCtx,
  since: Timestamp,
): AsyncGenerator<ProgressEvent[], void, undefined> {
  return walk(transport, ctx, since);
}

/** The sync context, plus the slug translation the parser needs. */
export interface NeetcodeSyncCtx extends SyncCtx {
  toLeetcodeSlug: ToLeetcodeSlug;
}
