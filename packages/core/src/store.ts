/**
 * The persistence seam.
 *
 * v1 ships an IndexedDB implementation (`@lcs/store`) and an in-memory one (below,
 * for tests). Adding cross-device sync later means writing a third implementation
 * against this interface — no changes to the domain logic, the UI, or the adapters.
 */

import type {
  ProblemState,
  ProgressEvent,
  ProviderId,
  ReviewCard,
  ReviewLog,
  Timestamp,
  TrackId,
} from "./model.js";
import type { Settings } from "./settings.js";

export interface EventStore {
  /**
   * Insert events, ignoring any whose `id` is already present.
   * Returns only the newly inserted events — this is what makes re-syncing idempotent
   * and lets the caller fold just the delta.
   */
  append(events: readonly ProgressEvent[]): Promise<ProgressEvent[]>;
  since(observedAfter: Timestamp): Promise<ProgressEvent[]>;
  all(): Promise<ProgressEvent[]>;
  /** Events from one provider, or every event when `provider` is omitted. */
  count(provider?: ProviderId): Promise<number>;
  /**
   * Drop events by id. Needed because the log is the source of truth: deleting a problem
   * without deleting its events would resurrect it on the next rebuild.
   */
  remove(ids: readonly string[]): Promise<number>;
}

/**
 * Problem state, addressed by `(provider, slug)`.
 *
 * Scoped to a provider for the same reason cards are scoped to a track: the two sites
 * record different things about the same problem, and a single merged row belonged to
 * neither of them.
 */
export interface ProblemStateStore {
  get(provider: ProviderId, slug: string): Promise<ProblemState | undefined>;
  getMany(provider: ProviderId, slugs: readonly string[]): Promise<ProblemState[]>;
  /** Every state for one provider, or across all of them when omitted. */
  all(provider?: ProviderId): Promise<ProblemState[]>;
  put(states: readonly ProblemState[]): Promise<void>;
  remove(provider: ProviderId, slugs: readonly string[]): Promise<number>;
}

/**
 * Cards, addressed by `(track, slug)`.
 *
 * Every read is scoped to a track. That's the whole point of the split: the queue you see
 * is one track's, and grading in one track must be invisible to the other.
 */
export interface CardStore {
  get(track: TrackId, slug: string): Promise<ReviewCard | undefined>;
  /** Cards in this track due at or before `at`, soonest first. */
  due(track: TrackId, at: Timestamp, limit?: number): Promise<ReviewCard[]>;
  /** Every card in one track, or across all tracks when `track` is omitted. */
  all(track?: TrackId): Promise<ReviewCard[]>;
  put(cards: readonly ReviewCard[]): Promise<void>;
  remove(track: TrackId, slug: string): Promise<void>;
}

export interface ReviewLogStore {
  append(logs: readonly ReviewLog[]): Promise<void>;
  /** This problem's grades within one track. */
  forProblem(track: TrackId, slug: string): Promise<ReviewLog[]>;
  since(reviewedAfter: Timestamp): Promise<ReviewLog[]>;
}

export interface SettingsStore {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

/** Small key-value space for sync cursors and one-off flags. */
export interface MetaStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Full local state. Doubles as the export format and the future sync payload.
 *
 * Version 2 added `track` to cards and logs; version 3 split problem state per provider.
 * `parseSnapshot` accepts either older version and migrates it, so old backups keep
 * working.
 */
export interface StoreSnapshot {
  version: 3;
  exportedAt: Timestamp;
  events: ProgressEvent[];
  problems: ProblemState[];
  cards: ReviewCard[];
  logs: ReviewLog[];
  settings: Settings;
}

export interface Store {
  readonly events: EventStore;
  readonly problems: ProblemStateStore;
  readonly cards: CardStore;
  readonly logs: ReviewLogStore;
  readonly settings: SettingsStore;
  readonly meta: MetaStore;

  exportSnapshot(): Promise<StoreSnapshot>;
  /** "merge" keeps existing rows and dedupes by id; "replace" wipes first. */
  importSnapshot(snapshot: StoreSnapshot, mode: "merge" | "replace"): Promise<void>;
  clear(): Promise<void>;
}
