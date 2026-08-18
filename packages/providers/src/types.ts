import type { ProgressEvent, ProviderId, SyncFailure, Timestamp } from "@lcs/core";

/**
 * The site-adapter seam.
 *
 * Adapters are the only part of the system that knows a website exists. They read the
 * user's own signed-in session *from within a tab on that origin* and emit normalized
 * `ProgressEvent`s. They never touch storage, never make cross-origin requests, and
 * never see a credential — cookies ride along because the code runs same-origin.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;

  /** Whether this adapter can run against the given page. */
  matches(url: URL): boolean;

  /** Who is signed in on this site, if anyone. */
  detectAuth(): Promise<AuthState>;

  /**
   * Everything the site knows about this user's history.
   * Yields in batches so the UI can show progress and the caller can persist as it goes.
   */
  fullSync(ctx: SyncCtx): AsyncIterable<ProgressEvent[]>;

  /** Only what changed since `since`. The default path; cheap enough to run often. */
  incrementalSync(ctx: SyncCtx, since: Timestamp): AsyncIterable<ProgressEvent[]>;

  /**
   * Live events from an open tab — e.g. an accepted submission, which triggers the
   * rating prompt. Observes requests the page already makes; issues none of its own.
   */
  observe(handler: (events: ProgressEvent[]) => void): Unsubscribe;
}

export type Unsubscribe = () => void;

export type AuthState =
  | { signedIn: true; username: string }
  | { signedIn: false; reason: "no-session" | "unknown" };

export interface SyncCtx {
  /** Wall clock, injected so sync is testable against recorded fixtures. */
  now(): Timestamp;
  /** Cooperative cancellation — the user closed the panel, or the tab went away. */
  signal?: AbortSignal;
  /** Progress reporting for the UI. */
  onProgress?(update: SyncProgress): void;
  /** Politeness gate. Adapters must await this before every network round trip. */
  throttle(): Promise<void>;
}

export interface SyncProgress {
  provider: ProviderId;
  phase: string;
  fetched: number;
  total: number | null;
}

/**
 * A failure already classified for the interface.
 *
 * Adapters know what went wrong far better than the code catching them does — an HTTP 401
 * is a dead session here and a missing problem there — so they say which of the handful of
 * user-facing conditions applies rather than leaving a string to be pattern-matched later.
 * The message stays technical and goes to the console.
 */
export class SyncError extends Error {
  constructor(
    readonly failure: SyncFailure,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** The classification of an unknown throw, defaulting to the vaguest answer. */
export function classifySyncError(error: unknown): SyncFailure {
  return error instanceof SyncError ? error.failure : "unknown";
}

/** Raised when a site's shape has changed and the adapter can't safely continue. */
export class ProviderShapeError extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderShapeError";
  }
}
