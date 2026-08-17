import type {
  Difficulty,
  IngestResult,
  ProgressEvent,
  ProviderId,
  ReviewRating,
  Settings,
  TrackId,
} from "@lcs/core";

/** One row in the review queue, flattened for display. */
export interface ReviewItem {
  slug: string;
  title: string;
  due: number;
  /** Positive means overdue. */
  overdueDays: number;
  attempts: number;
  lastSolvedAt: number | null;
  reps: number;
  /** From the bundled catalog; null when the slug isn't in it. */
  difficulty: Difficulty | null;
  topicTags: string[];
  url: string;
  /** Which site `url` points at — NeetCode when it hosts the problem, else LeetCode. */
  site: ProviderId;
}

export type SyncMode = "full" | "incremental";

export interface ProviderStatus {
  provider: ProviderId;
  /** Whether a tab on that origin is currently reachable. */
  connected: boolean;
  username: string | null;
  lastFullSyncAt: number | null;
  lastIncrementalSyncAt: number | null;
  lastError: string | null;
}

/** One track's headline numbers, so the selector can show both without two round trips. */
export interface TrackStatus {
  /** Problems with a review card in this track. */
  tracked: number;
  /** Problems this track's provider says you've solved. */
  solved: number;
  due: number;
  /** Submissions this track's provider has contributed to the log. */
  events: number;
}

export interface SyncStatus {
  running: boolean;
  providers: ProviderStatus[];
  tracks: Record<TrackId, TrackStatus>;
  activeTrack: TrackId;
  /** Across every track — distinct problems, not the sum of the per-track counts. */
  problemsTracked: number;
  solved: number;
  /** Reported by the background so UI surfaces never import the dataset itself. */
  catalog: { count: number; generatedAt: string | null };
}

/**
 * Every message that crosses a context boundary, with its response type.
 * Content scripts and UI never reach into each other — they go through the background.
 */
export interface MessageMap {
  "sync:run": { req: { provider: ProviderId; mode: SyncMode }; res: SyncStatus };
  "sync:status": { req: Record<string, never>; res: SyncStatus };
  "events:ingest": {
    req: {
      provider: ProviderId;
      events: ProgressEvent[];
      /**
       * This batch is the provider's *entire* known set, not a delta. NeetCode's payload
       * always is; LeetCode's arrives in pages, so it marks completion separately.
       */
      complete?: boolean;
    };
    res: IngestResult;
  };
  "provider:hello": {
    req: { provider: ProviderId; url: string; username?: string | null };
    res: { ack: true };
  };
  /**
   * Ask the background whether this tab should sync, and how far back.
   *
   * The background is the only thing that sees every tab, so it's the only place that can
   * stop two open leetcode.com tabs from walking the same history at once, or from
   * re-syncing on every single page navigation.
   */
  "sync:claim": {
    req: { provider: ProviderId };
    res: { mode: SyncMode | null; since: number };
  };
  /** Release the claim and record the outcome. Must follow every successful claim. */
  "sync:completed": {
    req: { provider: ProviderId; mode: SyncMode; error?: string | null };
    res: { ok: true };
  };
  "reviews:due": {
    req: { track: TrackId; limit?: number };
    res: {
      items: ReviewItem[];
      totalDue: number;
      limit: number;
      track: TrackId;
      /**
       * Cards in this track that exist but aren't due yet.
       *
       * Reported because a queue showing "3 of 18" out of 47 tracked problems looks like
       * 29 went missing. They're seeded and waiting; the panel has to say so.
       */
      scheduledAhead: number;
      /** When the next not-yet-due card comes up, or null if none are waiting. */
      nextDueAt: number | null;
      /**
       * Reviews graded in this track since local midnight.
       *
       * Read from the log rather than counted in the panel, so it survives the panel
       * being closed — which it is, most of the time.
       */
      reviewedToday: number;
    };
  };
  /**
   * Every card in a track, soonest-due first — the browse list.
   *
   * Separate from `reviews:due` because it is not polled: it is fetched when the list is
   * opened, and an account with thousands of cards shouldn't ship all of them every five
   * seconds to render a queue of ten.
   */
  "reviews:all": {
    req: { track: TrackId };
    res: { items: ReviewItem[]; track: TrackId };
  };
  /**
   * The NeetCode -> LeetCode slug table.
   *
   * The NeetCode content script needs it to key submissions, and a content script can't
   * fetch an extension asset unless it's declared web-accessible — which would hand the
   * whole catalogue to any page on the origin. Cheaper and narrower to pass it over.
   */
  "catalog:neetcode-slugs": {
    req: Record<string, never>;
    res: { byNeetcodeSlug: Record<string, string> };
  };
  "reviews:grade": {
    req: { track: TrackId; slug: string; rating: ReviewRating };
    res: { nextDue: number };
  };
  "settings:get": { req: Record<string, never>; res: Settings };
  "settings:update": { req: { patch: Partial<Settings> }; res: Settings };
  /**
   * Something wrote to the store from outside the background — an import, say. Lets the
   * badge catch up without every surface having to poll storage.
   */
  "data:changed": { req: Record<string, never>; res: { ok: true } };
  /** Wipe everything and start over. Settings are kept unless `settings` is true. */
  "data:reset": { req: { settings?: boolean }; res: { ok: true } };
  /** Re-apply one track's seeding strategy to its cards that have never been graded. */
  "schedule:rebuild": { req: { track: TrackId }; res: { rebuilt: number; kept: number } };
}

export type MessageType = keyof MessageMap;

type Envelope<T extends MessageType = MessageType> = {
  type: T;
  payload: MessageMap[T]["req"];
};

/** What `onMessage` replies with when a handler throws. */
interface ErrorEnvelope {
  error: string;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

export async function send<T extends MessageType>(
  type: T,
  payload: MessageMap[T]["req"],
): Promise<MessageMap[T]["res"]> {
  const response = await browser.runtime.sendMessage({ type, payload } satisfies Envelope<T>);

  // A failed handler replies with an error envelope, not a result. Casting that to the
  // response type hands callers an object missing every field they expect, so the real
  // failure surfaces as a TypeError somewhere unrelated. Throw here instead.
  if (isErrorEnvelope(response)) {
    throw new Error(`${type} failed: ${response.error}`);
  }

  if (response === undefined) {
    throw new Error(`${type} got no response — the background worker may not be running.`);
  }

  return response as MessageMap[T]["res"];
}

export type MessageHandlers = {
  [T in MessageType]?: (payload: MessageMap[T]["req"]) => Promise<MessageMap[T]["res"]>;
};

/** Register handlers in the background. Unknown message types are ignored, not thrown. */
export function onMessage(handlers: MessageHandlers): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const envelope = message as Partial<Envelope>;
    if (!envelope || typeof envelope.type !== "string") return false;

    const handler = handlers[envelope.type] as
      | ((payload: unknown) => Promise<unknown>)
      | undefined;
    if (!handler) return false;

    // Returning true keeps the message channel open for the async response.
    handler(envelope.payload).then(sendResponse, (error: unknown) => {
      console.error(`[lcs] handler for ${envelope.type} failed`, error);
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  });
}
