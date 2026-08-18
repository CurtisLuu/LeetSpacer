import { foldEvents } from "./events.js";
import type { ProviderId, ReviewCard, ReviewLog, TrackId } from "./model.js";
import type { StoreSnapshot } from "./store.js";
import {
  InvalidRecordError,
  validateAll,
  validateCard,
  validateEvent,
  validateLog,
  validateProblemState,
} from "./validate.js";

/**
 * Validate untrusted JSON before it reaches the store.
 *
 * Casting parsed JSON straight to `StoreSnapshot` lets anything through, and a
 * half-applied import is far worse than a rejected one. The error messages name what was
 * wrong with the file, since "import failed" tells nobody anything.
 *
 * Every *record* is checked, not just the four lists. Checking only the lists was the
 * same bug as not checking at all for anything that matters: a card with a `due` of
 * `null` imported cleanly and then vanished from the queue, because an invalid index key
 * makes IndexedDB skip the row. See `validate.ts`.
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

  // A `records` list is the shape of a debug capture from the recon phase — the most
  // likely wrong file to reach here, and it looks nothing like a snapshot. Worth naming
  // rather than failing on a missing "events" key three lines down.
  if (Array.isArray(candidate.records)) {
    throw new Error(
      "That looks like a debug capture, not a data snapshot. Use a file from Export JSON, or one produced by pnpm import:neetcode.",
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

  // Migrations run first: an older file is only expected to satisfy the current shape
  // once it has been brought forward.
  const current =
    candidate.version === 1
      ? splitProblems(migrateV1(candidate as unknown as LegacySnapshot))
      : candidate.version === 2
        ? splitProblems(candidate as unknown as V2Snapshot)
        : (candidate as StoreSnapshot);

  return checkRecords(current);
}

/**
 * Check every record, reporting the first bad one by list, position and field.
 *
 * `InvalidRecordError` is rewritten into the same voice as the errors above, because this
 * message is shown to whoever just picked the file.
 */
function checkRecords(snapshot: StoreSnapshot): StoreSnapshot {
  const lists = [
    ["events", snapshot.events, validateEvent],
    ["problems", snapshot.problems, validateProblemState],
    ["cards", snapshot.cards, validateCard],
    ["logs", snapshot.logs, validateLog],
  ] as const;

  for (const [name, records, validate] of lists) {
    try {
      validateAll(records as readonly unknown[], validate as (value: unknown) => unknown);
    } catch (cause) {
      if (cause instanceof InvalidRecordError) {
        throw new Error(`That file's "${name}" list has a problem — ${cause.reason}.`);
      }
      throw cause;
    }
  }

  return snapshot;
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
    // Cast because these are still candidates: `checkRecords` is what makes them cards.
    cards: (snapshot.cards as unknown[]).map(completeLegacyCard) as ReviewCard[],
    logs: (snapshot.logs as unknown[]).map(completeLegacyLog) as ReviewLog[],
  };
}

/**
 * Fill in scheduling fields an older export didn't carry.
 *
 * Only ever *adds* what is absent — every value the file does have is kept. Bringing an
 * old shape forward is a migration's whole job, and rejecting somebody's year-old backup
 * over a field that didn't exist when they made it would be the wrong way to be strict.
 * A missing `due` is not filled: that one is the card, and inventing it would invent a
 * schedule. The validation pass then rejects it by name.
 */
function completeLegacyCard(card: unknown): unknown {
  if (typeof card !== "object" || card === null) return card;
  const reps = (card as { reps?: unknown }).reps;
  return {
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    // A card with reviews behind it is a review card; one without has never been seen.
    phase: typeof reps === "number" && reps > 0 ? "review" : "new",
    lastReview: null,
    ...stripUndefined(card),
  };
}

function completeLegacyLog(log: unknown): unknown {
  if (typeof log !== "object" || log === null) return log;
  return {
    elapsedDays: 0,
    scheduledDays: 0,
    phase: "review",
    // Logs are written when someone grades something, so "manual" is what an entry from
    // before the field existed almost certainly was.
    source: "manual",
    ...stripUndefined(log),
  };
}

/** Spreading a record with explicit `undefined`s would erase the defaults underneath. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
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
