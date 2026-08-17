import { foldEvents } from "./events.js";
import type { ProviderId, ReviewCard, ReviewLog, TrackId } from "./model.js";
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

  if (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3) {
    throw new Error(
      `Expected a snapshot with version 1, 2 or 3, found ${JSON.stringify(candidate.version)}.`,
    );
  }

  for (const key of ["events", "problems", "cards", "logs"] as const) {
    if (!Array.isArray(candidate[key])) {
      throw new Error(`Snapshot is missing its "${key}" list.`);
    }
  }

  if (candidate.version === 1) return splitProblems(migrateV1(candidate as unknown as LegacySnapshot));
  if (candidate.version === 2) return splitProblems(candidate as unknown as V2Snapshot);
  return candidate as StoreSnapshot;
}

/** Version 2 and earlier: one problem row per slug, shared by both providers. */
interface V2Snapshot extends Omit<StoreSnapshot, "version" | "problems"> {
  version: 1 | 2;
  problems: unknown[];
}

/**
 * Rebuild problem state per provider by re-folding the event log.
 *
 * The merged rows can't be split apart — a solve date from one site and an attempt count
 * from the other leave nothing to attribute. The log can, because every event records
 * which provider it came from, so folding it again produces exactly the rows the current
 * model would have written. Nothing is lost: the log is the source of truth and it is
 * carried through untouched.
 */
function splitProblems(snapshot: V2Snapshot): StoreSnapshot {
  return {
    ...snapshot,
    version: 3,
    problems: [...foldEvents(new Map(), snapshot.events).values()],
  };
}

/**
 * A problem row as version 1 stored it: one per slug, listing every provider that had
 * said anything about it. Kept as its own type because the current model has no such
 * field, and the migration is the last code that will ever see one.
 */
export interface LegacyProblemState {
  slug: string;
  sources?: ProviderId[];
}

/** A version 1 snapshot: cards and logs keyed by slug alone, before tracks existed. */
interface LegacySnapshot extends Omit<StoreSnapshot, "version" | "cards" | "logs" | "problems"> {
  version: 1;
  problems: LegacyProblemState[];
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
export function trackForLegacyCard(problem: LegacyProblemState | undefined): TrackId {
  return problem?.sources?.includes("leetcode") ? "leetcode" : "neetcode";
}

function migrateV1(snapshot: LegacySnapshot): V2Snapshot {
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
