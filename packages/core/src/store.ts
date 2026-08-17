/**
 * The persistence seam.
 *
 * v1 ships an IndexedDB implementation (`@lcs/store`) and an in-memory one (below,
 * for tests). Adding cross-device sync later means writing a third implementation
 * against this interface — no changes to the domain logic, the UI, or the adapters.
 */

import type { ProblemState, ProgressEvent, ReviewCard, ReviewLog, Timestamp } from "./model.js";
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
  count(): Promise<number>;
  /**
   * Drop events by id. Needed because the log is the source of truth: deleting a problem
   * without deleting its events would resurrect it on the next rebuild.
   */
  remove(ids: readonly string[]): Promise<number>;
}

export interface ProblemStateStore {
  get(slug: string): Promise<ProblemState | undefined>;
  getMany(slugs: readonly string[]): Promise<ProblemState[]>;
  all(): Promise<ProblemState[]>;
  put(states: readonly ProblemState[]): Promise<void>;
  remove(slugs: readonly string[]): Promise<number>;
}

export interface CardStore {
  get(slug: string): Promise<ReviewCard | undefined>;
  /** Cards due at or before `at`, soonest first. */
  due(at: Timestamp, limit?: number): Promise<ReviewCard[]>;
  all(): Promise<ReviewCard[]>;
  put(cards: readonly ReviewCard[]): Promise<void>;
  remove(slug: string): Promise<void>;
}

export interface ReviewLogStore {
  append(logs: readonly ReviewLog[]): Promise<void>;
  forProblem(slug: string): Promise<ReviewLog[]>;
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

/** Full local state. Doubles as the export format and the future sync payload. */
export interface StoreSnapshot {
  version: 1;
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
