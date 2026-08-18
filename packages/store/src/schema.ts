import type { ProblemState, ProgressEvent, ReviewCard, ReviewLog } from "@lcs/core";
import type { DBSchema } from "idb";

/**
 * Kept at the pre-rebrand name on purpose. The database name is the address of everyone's
 * existing history — renaming it to match "LeetSpacer" would leave that data stranded in
 * an orphaned database and present as a total loss on upgrade. It's invisible to users;
 * the cost of changing it is not.
 */
export const DB_NAME = "leetcode-spaced";

/**
 * v2 split reviews into per-track schedules: `cards` is now keyed on `[track, slug]`
 * instead of `slug`, and `logs` carries a track too. See `upgrade` in idb-store.ts for
 * how existing rows are moved across.
 *
 * v3 indexed `events` by provider, so a per-track event count doesn't mean loading the
 * entire log on every status poll.
 *
 * v4 split `problems` per provider: keyed on `[provider, slug]` instead of `slug`. The old
 * merged rows can't be pulled apart, so the upgrade empties the store and the extension
 * refolds it from the event log, which records a provider on every entry.
 */
export const DB_VERSION = 4;

/** Settings and sync cursors share one key-value store to keep the schema small. */
export const SETTINGS_KEY = "settings";
export const META_PREFIX = "meta:";

export interface LcsDB extends DBSchema {
  events: {
    key: string;
    value: ProgressEvent;
    indexes: { observedAt: number; provider: string };
  };
  problems: {
    /** `[provider, slug]`. */
    key: [string, string];
    value: ProblemState;
    indexes: { provider: string };
  };
  cards: {
    /** `[track, slug]`. */
    key: [string, string];
    value: ReviewCard;
    /**
     * Compound `[track, due]`, not a bare `due`. A queue read is always "this track's
     * cards, soonest first", and a bare index would make that a full scan plus a filter.
     */
    indexes: { trackDue: [string, number] };
  };
  logs: {
    key: string;
    value: ReviewLog;
    indexes: { trackSlug: [string, string]; reviewedAt: number };
  };
  kv: {
    key: string;
    value: unknown;
  };
}
