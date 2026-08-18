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
import type { ProviderSettings, Settings, TrackSettings } from "./settings.js";

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
  /**
   * Every state for one provider, or across all of them when omitted.
   *
   * The unscoped call exists for export and repair only. Anything that feeds a *track*
   * passes the provider: a merged list keyed by slug alone is how the two sites end up
   * overwriting each other.
   */
  all(provider?: ProviderId): Promise<ProblemState[]>;
  /**
   * How many of one provider's problems are solved.
   *
   * Counted rather than loaded because the status surfaces poll every couple of seconds,
   * and `all()` there meant deserializing every row in the account several times a second
   * to produce one integer.
   */
  countSolved(provider: ProviderId): Promise<number>;
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
  /** How many cards this track holds. */
  count(track: TrackId): Promise<number>;
  /** How many of them are due at or before `at`. */
  countDue(track: TrackId, at: Timestamp): Promise<number>;
  /**
   * The soonest card in this track that isn't due yet, or undefined if none is waiting.
   *
   * Its own method because the alternative is loading every card in the track to find one
   * date, which is what the queue used to do on a five-second poll.
   */
  nextAfter(track: TrackId, at: Timestamp): Promise<ReviewCard | undefined>;
  /**
   * Write cards. Rejects a card that couldn't be read back — see `validateCard`.
   *
   * Every card carries the track it belongs to and is addressed by it, so a write can
   * only ever land in one schedule.
   */
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
  /**
   * Merge top-level fields.
   *
   * Shallow: a patch carrying `providers` or `tracks` replaces that whole map. Use the
   * two scoped methods below for anything inside them — see why there.
   */
  update(patch: Partial<Settings>): Promise<Settings>;
  /**
   * Change one source's settings, touching nothing else.
   *
   * The narrow shape is the point. Writing settings meant sending the whole `providers`
   * map, built from whatever the caller had read earlier — so the options page saving
   * "NeetCode off" also wrote back its stale copy of LeetCode's sync timestamps, and the
   * background recording a sync wrote back its stale copy of the NeetCode switch. Each
   * silently undid the other, and no amount of transaction discipline helps when the
   * payload itself carries the other site's state. Here a write can only ever name one
   * site, so there is nothing of the other's to get wrong.
   */
  patchProvider(provider: ProviderId, patch: Partial<ProviderSettings>): Promise<Settings>;
  /** The same, for one track's schedule settings. */
  patchTrack(track: TrackId, patch: Partial<TrackSettings>): Promise<Settings>;
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

/** What a scoped erase removed, per record type. */
export interface ClearedCounts {
  events: number;
  problems: number;
  cards: number;
  logs: number;
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
  /**
   * Erase everything one site contributed, and nothing else.
   *
   * The two sites are two applications, so starting over has to be available for one of
   * them without touching the other. This removes that provider's events and problem
   * state, that track's cards and review log, and rewinds its sync cursors so opening the
   * site imports its history again from scratch. The other track — its cards, its grades,
   * its cursors — is not read and not written.
   *
   * `TrackId` and `ProviderId` are the same value; both meanings apply here, because the
   * schedule and the history it was built from go together. Kept: the source's on/off
   * switch and the track's schedule settings, which are choices rather than data.
   */
  clearTrack(track: TrackId): Promise<ClearedCounts>;
  /** Erase both, leaving settings. */
  clear(): Promise<void>;
}
