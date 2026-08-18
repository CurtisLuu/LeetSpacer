/**
 * Turning solved problems into review cards, per track.
 *
 * Lives in core rather than the background worker because it is the step that decides
 * what you actually see each day, and it needs to be testable without a browser.
 */

import { type ProblemState, type ReviewCard, TRACK_IDS, type TrackId } from "./model.js";
import { createScheduler } from "./scheduler.js";
import { distributeDueDates } from "./seeding.js";
import type { Settings } from "./settings.js";
import type { Store } from "./store.js";

export interface SeedResult {
  /** Cards created, per track. */
  seeded: Record<TrackId, number>;
  total: number;
}

/**
 * Give every solved problem a review card in the track it belongs to, without disturbing
 * cards that already exist. Re-running a sync must never reset a schedule you've been
 * building.
 *
 * A track is seeded only from its own provider's records, so a problem you've done on both
 * sites gets a card in each — with that site's own dates and attempt counts behind it.
 */
export async function seedMissingCards(
  store: Store,
  now: number = Date.now(),
): Promise<SeedResult> {
  const settings = await store.settings.get();
  const seeded = { leetcode: 0, neetcode: 0 } as Record<TrackId, number>;

  for (const track of TRACK_IDS) {
    // A track is fed by its own provider's records and nothing else.
    const problems = await store.problems.all(track);
    seeded[track] = await seedTrack(store, settings, problems, track, now);
  }

  return { seeded, total: seeded.leetcode + seeded.neetcode };
}

async function seedTrack(
  store: Store,
  settings: Settings,
  problems: readonly ProblemState[],
  track: TrackId,
  now: number,
): Promise<number> {
  const tuning = settings.tracks[track];
  const scheduler = createScheduler({ requestRetention: tuning.requestRetention });

  // One read of the track's existing cards, not one lookup per problem. A full LeetCode
  // sync calls this after every page of history, so a per-problem `get` here is a lookup
  // per solved problem per page — quadratic in the size of the account, and slow enough
  // on a large history to look like the sync has hung.
  const existing = new Set((await store.cards.all(track)).map((card) => card.slug));

  const dated: ReviewCard[] = [];
  const undated: ReviewCard[] = [];

  for (const problem of problems) {
    if (problem.status !== "solved" || problem.lastSolvedAt === null) continue;
    if (existing.has(problem.slug)) continue;

    const card = scheduler.seed(
      track,
      problem.slug,
      problem.lastSolvedAt,
      Math.max(1, problem.attempts),
    );

    // Split by whether the solve date is real. A dated card is already scheduled from
    // when the problem was actually solved — the best information available — so it goes
    // in untouched. Only the dateless ones need a strategy.
    (problem.hasDatedSolve ? dated : undated).push(card);
  }

  if (dated.length === 0 && undated.length === 0) return 0;

  await store.cards.put([
    ...dated,
    ...distributeDueDates(undated, {
      strategy: tuning.seedStrategy,
      now,
      spreadDays: tuning.seedSpreadDays,
    }),
  ]);

  return dated.length + undated.length;
}
