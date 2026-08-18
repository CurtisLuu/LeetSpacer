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
 *
 * v5 indexed `problems` by `[provider, status]`, so "how many has this site says you've
 * solved" is a count rather than a full read of the account — the status surfaces poll it
 * every couple of seconds. The same upgrade repairs any card whose `due` is not a finite
 * number: such a card is invisible to the `[track, due]` index and so to the queue, the
 * badge and the browse list, while still existing.
 */
export const DB_VERSION = 5;

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
    /**
     * `provider` for "everything this site knows", `providerStatus` for the counts the
     * UI polls. Both are compound-free reads scoped to one site — nothing in the schema
     * can address a problem without saying which site it came from.
     */
    indexes: { provider: string; providerStatus: [string, string] };
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
