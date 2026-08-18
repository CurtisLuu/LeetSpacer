import type {
  ClearedCounts,
  Difficulty,
  IngestResult,
  ProgressEvent,
  ProviderId,
  ProviderSettings,
  ReviewRating,
  Settings,
  SyncFailure,
  TrackId,
  TrackSettings,
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
  /**
   * Whether a tab on that origin checked in recently enough to still count.
   *
   * Derived from a stored timestamp rather than from something the service worker
   * remembers, because it does not remember anything for longer than about thirty
   * seconds. Nothing reports a tab closing, so this is "seen lately", not "open now".
   */
  connected: boolean;
  /** When that check-in was, or null if this source has never reported in. */
  lastSeenAt: number | null;
  username: string | null;
  /** Settings -> Your history. A source switched off is not read at all. */
  enabled: boolean;
  lastFullSyncAt: number | null;
  lastIncrementalSyncAt: number | null;
  /**
   * Why the last sync stopped, classified. Not a message: the interface writes its own
   * copy from this, so a raw failure string can never reach a reader.
   */
  lastFailure: SyncFailure | null;
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
  /**
   * One entry per track, and no totals across them.
   *
   * There used to be a `problemsTracked` and a `solved` spanning both. Nothing rendered
   * them — every surface reads `tracks[activeTrack]` — and computing them meant loading
   * every problem row in the account on a two-second poll to produce a number that
   * describes neither schedule.
   */
  tracks: Record<TrackId, TrackStatus>;
  activeTrack: TrackId;
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
    /**
     * `failure` is set when the write itself could not happen — a full storage profile,
     * which no amount of retrying fixes. The walk stops on it rather than paging on into
     * a store that cannot accept anything.
     */
    res: IngestResult & { failure?: SyncFailure };
  };
  "provider:hello": {
    /**
     * Deliberately carries no page URL. The greeting is sent before consent is known, and
     * which problem page you happen to be on is not something to hand over at that point
     * — the background has never needed it.
     *
     * `username` is sent on a second greeting, once consent is confirmed and the site has
     * been asked who is signed in.
     */
    req: { provider: ProviderId; username?: string | null };
    /**
     * Both gates ride along on the greeting every content script already sends, so
     * gating the read costs no extra round trip. `enabled` is Settings -> Your history:
     * off means stand down entirely, not just skip the history walk.
     */
    res: { ack: true; consented: boolean; enabled: boolean };
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
    res: {
      mode: SyncMode | null;
      since: number;
      /** Why a null mode was returned. Silence here is impossible to diagnose from. */
      reason?: "disabled" | "in-flight" | "too-soon" | "not-accepted";
    };
  };
  /** Release the claim and record the outcome. Must follow every successful claim. */
  "sync:completed": {
    req: { provider: ProviderId; mode: SyncMode; failure?: SyncFailure | null };
    res: { ok: true };
  };
  "reviews:due": {
    req: { track: TrackId; limit?: number };
    res: {
      items: ReviewItem[];
      totalDue: number;
      /** The cap this response was built with — the daily limit, or what "load more" asked for. */
      limit: number;
      /**
       * The track's `dailyReviewLimit` setting, whatever this request asked for.
       *
       * Separate from `limit` because the panel uses it as the batch size and as the
       * "reviewed today" denominator. Reading those off `limit` meant every "load more"
       * became the new daily limit and the next press asked for double again.
       */
      dailyLimit: number;
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
  /** Top-level settings only — the active track, where problems open. */
  "settings:update": { req: { patch: Partial<Settings> }; res: Settings };
  /**
   * One source's settings, or one track's, and never both at once.
   *
   * Separate messages rather than one `settings:update` carrying a whole `providers` or
   * `tracks` map, because that map is built from whatever the sender read earlier: the
   * options page saving "NeetCode off" was also writing back its stale copy of LeetCode's
   * sync timestamps, and the background recording a sync was writing back its stale copy
   * of the NeetCode switch. Naming one side is what makes that impossible.
   */
  "settings:patch-provider": {
    req: { provider: ProviderId; patch: Partial<ProviderSettings> };
    res: Settings;
  };
  "settings:patch-track": { req: { track: TrackId; patch: Partial<TrackSettings> }; res: Settings };
  /**
   * Something wrote to the store from outside the background — an import, say. Lets the
   * badge catch up without every surface having to poll storage.
   */
  "data:changed": { req: Record<string, never>; res: { ok: true } };
  /** Wipe everything and start over. Settings are kept unless `settings` is true. */
  "data:reset": { req: { settings?: boolean }; res: { ok: true } };
  /**
   * Wipe one site and start that one over, leaving the other untouched.
   *
   * The two are separate applications everywhere else — separate history, schedule,
   * grades and pacing — so starting over has to be available for one of them on its own.
   * Removes that source's events and problem records, that track's cards and grades, and
   * rewinds its sync cursors so opening the site imports it again from scratch.
   */
  "data:reset-track": { req: { track: TrackId }; res: { cleared: ClearedCounts } };
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
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own contexts. Nothing can reach here today — there is no
    // `externally_connectable`, no `web_accessible_resources` and no `onMessageExternal`
    // listener — but these handlers include `data:reset`, and the day one of those three
    // is added is not the day to remember this check was missing.
    if (sender.id !== browser.runtime.id) return false;

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
