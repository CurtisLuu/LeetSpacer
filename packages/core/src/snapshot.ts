import type { ProblemState, ReviewCard, ReviewLog, TrackId } from "./model.js";
import type { StoreSnapshot } from "./store.js";

/**
 * Validate untrusted JSON before it reaches the store.
 *
 * Casting parsed JSON straight to `StoreSnapshot` lets anything through, and a
 * half-applied import is far worse than a rejected one. The error messages name what was
 * wrong with the file, since "import failed" tells nobody anything.
 */
export function parseSnapshot(text: string): StoreSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("That JSON isn't an object.");
  }

  // `version` is deliberately widened to unknown: the point of this function is to check
  // it, and typing it as the current version would make every comparison below look
  // impossible to the compiler.
  const candidate = parsed as Omit<Partial<StoreSnapshot>, "version"> & {
    version?: unknown;
    records?: unknown;
  };

  // Capture-mode exports are the most likely wrong file to reach this, and they look
  // nothing like a snapshot — worth saying so by name.
  if (Array.isArray(candidate.records)) {
    throw new Error(
      "That looks like a capture-mode export, not a data snapshot. Use a file from Export JSON, or one produced by pnpm import:neetcode.",
    );
  }

  if (candidate.version !== 1 && candidate.version !== 2) {
    throw new Error(
      `Expected a snapshot with version 1 or 2, found ${JSON.stringify(candidate.version)}.`,
    );
  }

  for (const key of ["events", "problems", "cards", "logs"] as const) {
    if (!Array.isArray(candidate[key])) {
      throw new Error(`Snapshot is missing its "${key}" list.`);
    }
  }

  return candidate.version === 1
    ? migrateV1(candidate as unknown as LegacySnapshot)
    : (candidate as StoreSnapshot);
}

/** A version 1 snapshot: cards and logs keyed by slug alone, before tracks existed. */
interface LegacySnapshot extends Omit<StoreSnapshot, "version" | "cards" | "logs"> {
  version: 1;
  cards: Omit<ReviewCard, "track">[];
  logs: Omit<ReviewLog, "track">[];
}

/**
 * Assign a track to everything in a pre-split backup.
 *
 * The problem's own sources are the best evidence available. LeetCode wins a tie because
 * its history carries real solve dates, which is the schedule worth preserving; a problem
 * with no recorded source at all goes to NeetCode, since that was the only working data
 * path before the LeetCode adapter existed.
 */
export function trackForLegacyCard(problem: ProblemState | undefined): TrackId {
  return problem?.sources.includes("leetcode") ? "leetcode" : "neetcode";
}

function migrateV1(snapshot: LegacySnapshot): StoreSnapshot {
  const problems = new Map(snapshot.problems.map((problem) => [problem.slug, problem]));
  const trackFor = (slug: string) => trackForLegacyCard(problems.get(slug));

  return {
    ...snapshot,
    version: 2,
    cards: snapshot.cards.map((card) => ({ ...card, track: trackFor(card.slug) })),
    logs: snapshot.logs.map((log) => {
      const track = trackFor(log.slug);
      // The id gained a track segment, and two logs that used to collide across tracks
      // must not collide now.
      return { ...log, track, id: `${track}:${log.slug}:${log.reviewedAt}` };
    }),
  };
}
