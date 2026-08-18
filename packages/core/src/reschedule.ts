/**
 * Re-applying one track's seeding strategy to the cards it has never graded.
 *
 * Lives here rather than in the background worker for the same reason `seedMissingCards`
 * does: it decides what someone sees each day, and it is the piece of the system most
 * able to destroy a real schedule by accident, so it needs to be testable without a
 * browser.
 *
 * It reads *one track's* cards and *one provider's* problem rows. That is the invariant
 * this file exists to hold: the version that read `problems.all()` and keyed the result by
 * slug alone merged the two sites back together, and for any problem solved on both, the
 * last row written won — so applying the strategy to the LeetCode track could replace a
 * schedule derived from a real submission date with one seeded from NeetCode's dateless
 * record of the same problem.
 */

import { type ReviewCard, type TrackId } from "./model.js";
import { createScheduler } from "./scheduler.js";
import { distributeDueDates } from "./seeding.js";
import type { Store } from "./store.js";

export interface RescheduleResult {
  /** Cards re-seeded from their provider's own record. */
  rebuilt: number;
  /** Cards left alone because they carry review history. */
  kept: number;
}

export async function rebuildTrackSchedule(
  store: Store,
  track: TrackId,
  now: number = Date.now(),
): Promise<RescheduleResult> {
  const settings = await store.settings.get();
  const tuning = settings.tracks[track];
  const scheduler = createScheduler({ requestRetention: tuning.requestRetention });

  // A track is fed by its own provider's records and nothing else. `TrackId` is an alias
  // of `ProviderId` precisely so this reads as the one thing it is allowed to mean.
  const [cards, problems] = await Promise.all([
    store.cards.all(track),
    store.problems.all(track),
  ]);
  const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));

  const dated: ReviewCard[] = [];
  const undated: ReviewCard[] = [];
  let kept = 0;

  for (const card of cards) {
    // Anything you have graded is real data and is left exactly where it is.
    const reviewed = await store.logs.forProblem(track, card.slug);
    if (reviewed.length > 0) {
      kept += 1;
      continue;
    }
    const problem = bySlug.get(card.slug);
    if (!problem?.lastSolvedAt) continue;

    const seeded = scheduler.seed(
      track,
      card.slug,
      problem.lastSolvedAt,
      Math.max(1, problem.attempts),
    );

    // A real solve date is the best information the system has, so it is re-seeded from
    // that date and kept out of the redistribution — the same rule seeding follows.
    (problem.hasDatedSolve ? dated : undated).push(seeded);
  }

  if (dated.length > 0 || undated.length > 0) {
    await store.cards.put([
      ...dated,
      ...distributeDueDates(undated, {
        strategy: tuning.seedStrategy,
        now,
        spreadDays: tuning.seedSpreadDays,
      }),
    ]);
  }

  return { rebuilt: dated.length + undated.length, kept };
}
