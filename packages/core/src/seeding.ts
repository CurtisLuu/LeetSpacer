/**
 * Deciding when freshly imported problems should first come up for review.
 *
 * NeetCode tells us *that* a problem is solved, never when. Seeding a card with "solved
 * just now" puts it in FSRS's learning state, due in about ten minutes — so the queue
 * looks empty, then dumps everything at once. Neither is what anyone wants from an
 * import, so the due dates get redistributed here.
 */

import type { ReviewCard, Timestamp } from "./model.js";
import { MS_PER_DAY } from "./clock.js";

export type SeedStrategy = "now" | "spread";

export interface SeedOptions {
  strategy: SeedStrategy;
  now: Timestamp;
  /** Only used by "spread": how many days to fan the backlog across. */
  spreadDays: number;
}

/**
 * Order for the backlog: hardest first.
 *
 * FSRS difficulty is derived from the grade we seeded with, which comes from how many
 * submissions a problem took. So the problems that gave you trouble surface first, and
 * the ties break on slug purely so the result is stable between runs.
 */
function hardestFirst(a: ReviewCard, b: ReviewCard): number {
  return b.difficulty - a.difficulty || a.slug.localeCompare(b.slug);
}

/**
 * Rewrite the due dates of freshly seeded cards.
 *
 * Returns new card objects; the input is untouched. Cards keep their FSRS state — only
 * `due` moves, so the scheduler still behaves normally from the first review onward.
 */
export function distributeDueDates(
  cards: readonly ReviewCard[],
  options: SeedOptions,
): ReviewCard[] {
  if (cards.length === 0) return [];

  const ordered = [...cards].sort(hardestFirst);

  if (options.strategy === "now") {
    // Everything available immediately. The daily review limit is what stops this
    // from being overwhelming — the backlog is worked through a slice at a time.
    return ordered.map((card) => ({ ...card, due: options.now }));
  }

  const days = Math.max(1, Math.floor(options.spreadDays));
  return ordered.map((card, index) => ({
    ...card,
    // Evenly fanned across the window, hardest on day zero.
    due: options.now + Math.floor((index * days) / ordered.length) * MS_PER_DAY,
  }));
}
