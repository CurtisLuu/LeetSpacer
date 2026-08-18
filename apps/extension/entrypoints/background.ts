import {
  type ProviderId,
  type ReviewCard,
  type Settings,
  type SyncFailure,
  type TrackId,
  TRACK_IDS,
  createScheduler,
  hasAcceptedPrivacy,
  ingestEvents,
  isStorageFull,
  rebuildTrackSchedule,
  seedMissingCards,
  withMinimumLock,
} from "@lcs/core";

import { getCatalog, getProblemLinks } from "../lib/catalog.js";
import { titleFromSlug } from "../lib/format.js";
import { type ProviderStatus, type ReviewItem, type SyncStatus, onMessage } from "../lib/messaging.js";
import { getStore } from "../lib/store.js";

/** Providers with a working data path. Both read from a tab you already have open. */
const ACTIVE_PROVIDERS: ProviderId[] = ["neetcode", "leetcode"];

const SYNC_ALARM = "lcs:incremental-sync";
const SYNC_PERIOD_MINUTES = 60 * 6;
const MS_PER_DAY = 86_400_000;

/**
 * How long an incremental sync stays fresh. LeetCode's content script asks on every page
 * load, and walking the submission history every time you click a problem would be both
 * slow and rude.
 */
const INCREMENTAL_INTERVAL_MS = 15 * 60 * 1000;

/**
 * How recently a tab on each site checked in, and how the last sync ended.
 *
 * Persisted rather than held in module state. MV3 evicts this worker after about thirty
 * seconds idle, and the previous in-memory `Set` went with it — so the popup said "not
 * connected" and the provider card said "no tab open" while a leetcode.com tab sat there
 * syncing, and the explanation for a real failure vanished on the next poll.
 *
 * Only ever written after consent: a greeting that arrives before the policy is accepted
 * must leave nothing behind, timestamps included.
 */
const LAST_SEEN_KEY = (provider: ProviderId) => `provider:${provider}:lastSeenAt`;
const LAST_FAILURE_KEY = (provider: ProviderId) => `provider:${provider}:lastFailure`;

/**
 * How long a check-in still counts as "connected".
 *
 * A content script greets on page load and again on every batch it ingests, so an active
 * sync keeps refreshing this. Nothing reports a tab *closing*, so past this window the
 * honest answer is that we no longer know — and the advice that follows from it, "open
 * the site", is right either way.
 */
const CONNECTED_WINDOW_MS = 5 * 60 * 1000;

async function noteSeen(provider: ProviderId): Promise<void> {
  await (await getStore()).meta.set(LAST_SEEN_KEY(provider), Date.now());
}

async function noteFailure(provider: ProviderId, failure: SyncFailure | null): Promise<void> {
  const store = await getStore();
  if (failure === null) await store.meta.remove(LAST_FAILURE_KEY(provider));
  else await store.meta.set(LAST_FAILURE_KEY(provider), failure);
}

/**
 * Clear a stale failure when a tab checks in — except one.
 *
 * Opening the site again is evidence that a signed-out or unreachable state may be over.
 * It is no evidence at all about a full profile, so `storage-full` stays until a sync
 * actually completes; clearing it on a page load would make the one failure that needs
 * acting on flicker away and come back.
 */
async function clearRecoverableFailure(provider: ProviderId): Promise<void> {
  const store = await getStore();
  const failure = await store.meta.get<SyncFailure>(LAST_FAILURE_KEY(provider));
  if (failure === undefined || failure === "storage-full") return;
  await store.meta.remove(LAST_FAILURE_KEY(provider));
}

/**
 * Providers with a sync in flight, so a second tab doesn't duplicate the work.
 *
 * In memory on purpose: MV3 tears this worker down freely, and a claim that outlived the
 * worker would deadlock syncing until the browser restarted. Losing it just means a
 * redundant sync, which the deterministic event ids make harmless.
 */
const syncing = new Set<ProviderId>();

/**
 * When each provider was last *asked* to sync, successful or not.
 *
 * Separate from the stored cursors, which only advance on success. Without it a sync that
 * keeps failing would be reclaimed by every page load forever — and for a first-run full
 * sync that means re-walking the entire submission history each time.
 */
const lastAttemptAt = new Map<ProviderId, number>();

export default defineBackground(() => {
  // No `setPanelBehavior({ openPanelOnActionClick: true })` here. There is a popup
  // entrypoint, so the manifest carries `action.default_popup`, and the popup always wins
  // the toolbar click — the call was inert and its comment claimed otherwise. The popup
  // opens the side panel itself.

  // Open the walkthrough once, on install only.
  //
  // It earns the tab: LeetSpacer has nothing to show until history syncs, and history only
  // syncs when you visit a site it reads — so an install with no instruction produces a
  // panel that says "nothing here" and looks broken. Deliberately not on update, which
  // would interrupt people who already know how it works.
  //
  // `tabs.create` needs no `tabs` permission; that one is only for reading tab contents.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;
    void browser.tabs
      .create({ url: browser.runtime.getURL("/welcome.html") })
      .catch((error: unknown) => console.error("[lcs] welcome tab", error));
  });

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    void refreshBadge();
  });

  void refreshBadge();

  onMessage({
    "provider:hello": async ({ provider, username }) => {
      const settings = await (await getStore()).settings.get();
      const consented = hasAcceptedPrivacy(settings);
      const enabled = settings.providers[provider].enabled;

      // Nothing at all is recorded before the two gates — not the username, and not the
      // fact that a tab said hello. A greeting that arrives before acceptance must leave
      // no trace of any kind.
      if (consented && enabled) {
        await noteSeen(provider);
        await clearRecoverableFailure(provider);
        if (username) await patchProvider(provider, { username });
      }

      return { ack: true, consented, enabled };
    },

    "events:ingest": async ({ provider, events, complete }) => {
      const store = await getStore();
      const settings = await store.settings.get();
      const ignored = { received: events.length, inserted: 0, updatedProblems: [] };

      // The last line of defence: nothing is written before consent, whatever sent it.
      if (!hasAcceptedPrivacy(settings)) return ignored;

      // Nor from a source that has been switched off. The content scripts stand down on
      // their own, but a tab that was already open when the switch was flipped is still
      // running the old answer — and "stops it being read" has to mean it.
      if (!settings.providers[provider].enabled) return ignored;

      await noteSeen(provider);

      try {
        const result = await ingestEvents(store, events);

        if (result.inserted > 0) {
          // Only this provider's track: its own events cannot have created a card in the
          // other one.
          await seedMissingCards(store, Date.now(), provider);
          const now = Date.now();
          await patchProvider(provider, {
            lastIncrementalSyncAt: now,
            // Only a batch that *is* the whole set proves a full sync happened. LeetCode
            // pages its history, so an early page saying "full sync done" would strand the
            // rest of it if the tab closed.
            ...(complete ? { lastFullSyncAt: now } : {}),
          });
          await refreshBadge();
        }

        return result;
      } catch (cause) {
        // A full profile is not a failed sync to be retried, and it is the one cause that
        // reaches here as a write error rather than as a `SyncError` from an adapter.
        // Reported in the response so the walk stops, and recorded so the provider card
        // explains it — a rejection here would cross the message boundary as a plain
        // Error and be classified "unknown", which advises reopening the site for ever.
        if (!isStorageFull(cause)) throw cause;
        console.error("[lcs] storage full while ingesting", cause);
        await noteFailure(provider, "storage-full");
        return { ...ignored, failure: "storage-full" as const };
      }
    },

    "sync:status": async () => buildStatus(),

    "sync:claim": async ({ provider }) => {
      const settings = await (await getStore()).settings.get();
      const state = settings.providers[provider];
      const now = Date.now();

      // Belt and braces. The content scripts stop before they get here, but a sync path
      // added later shouldn't have to remember to check.
      if (!hasAcceptedPrivacy(settings)) {
        return { mode: null, since: 0, reason: "not-accepted" } as const;
      }
      if (!state.enabled) return { mode: null, since: 0, reason: "disabled" } as const;
      if (syncing.has(provider)) return { mode: null, since: 0, reason: "in-flight" } as const;

      const attempted = lastAttemptAt.get(provider);
      if (attempted !== undefined && now - attempted < INCREMENTAL_INTERVAL_MS) {
        return { mode: null, since: 0, reason: "too-soon" } as const;
      }

      const since = state.lastFullSyncAt === null
        ? null
        : (state.lastIncrementalSyncAt ?? state.lastFullSyncAt);

      if (since !== null && now - since < INCREMENTAL_INTERVAL_MS) {
        return { mode: null, since: 0, reason: "too-soon" } as const;
      }

      syncing.add(provider);
      lastAttemptAt.set(provider, now);
      return since === null ? { mode: "full", since: 0 } : { mode: "incremental", since };
    },

    "sync:completed": async ({ provider, mode, failure }) => {
      syncing.delete(provider);
      const now = Date.now();

      if (failure) {
        await noteFailure(provider, failure);
      } else {
        await noteFailure(provider, null);
        await patchProvider(provider, {
          lastIncrementalSyncAt: now,
          ...(mode === "full" ? { lastFullSyncAt: now } : {}),
        });
      }

      await refreshBadge();
      return { ok: true } as const;
    },

    "sync:run": async () => {
      // Nothing to trigger from here: both providers read from a tab on their own origin,
      // and this worker has no `tabs` permission to reach into one. The provider cards say
      // so; there is nothing to report as a failure.
      return buildStatus();
    },

    "reviews:due": async ({ track, limit }) => {
      const store = await getStore();
      const now = Date.now();
      // Local midnight, not a rolling 24 hours: "today" has to mean the same thing to
      // the panel as it does to the person reading it.
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      const settings = await store.settings.get();
      const dailyLimit = settings.tracks[track].dailyReviewLimit;
      const cap = limit ?? dailyLimit;

      // Counted and range-read through the `[track, due]` index rather than loaded and
      // filtered. This handler is polled every few seconds by an open panel, and reading
      // every card in the track to work out two integers kept the worker awake and
      // deserializing thousands of rows a minute on a full history.
      const [totalDue, tracked, selected, next, todaysLogs] = await Promise.all([
        store.cards.countDue(track, now),
        store.cards.count(track),
        // Already sorted soonest-first by the index, so the most overdue come first —
        // those are the ones closest to being forgotten.
        store.cards.due(track, now, cap),
        store.cards.nextAfter(track, now),
        store.logs.since(midnight.getTime()),
      ]);

      const items = await toReviewItems(selected, track, settings.problemLinkTarget, now);

      return {
        items,
        totalDue,
        // What this response was capped at, which is not necessarily the setting: a
        // "load more" asks for a bigger batch. Reporting the two separately is the fix
        // for a panel that adopted each request as the new daily limit and then doubled
        // it on every press.
        limit: cap,
        dailyLimit,
        track,
        // Everything seeded but not yet due. Mostly the dateless backfill, which the
        // seeding strategy deliberately fans across a window instead of dumping at once.
        scheduledAhead: Math.max(0, tracked - totalDue),
        nextDueAt: next?.due ?? null,
        reviewedToday: todaysLogs.filter((log) => log.track === track).length,
      };
    },

    "reviews:all": async ({ track }) => {
      const store = await getStore();
      const now = Date.now();
      const [settings, cards] = await Promise.all([
        store.settings.get(),
        store.cards.all(track),
      ]);

      // Soonest first, so the ones about to unlock are at the top where a countdown is
      // worth reading.
      const sorted = [...cards].sort((a, b) => a.due - b.due);
      return { items: await toReviewItems(sorted, track, settings.problemLinkTarget, now), track };
    },

    "catalog:neetcode-slugs": async () => ({
      byNeetcodeSlug: (await getProblemLinks()).neetcodeToLeetcode(),
    }),

    "data:changed": async () => {
      await refreshBadge();
      return { ok: true } as const;
    },

    "data:reset": async ({ settings: alsoSettings }) => {
      const store = await getStore();
      const keep = alsoSettings ? null : await store.settings.get();

      await store.clear();
      // Settings are configuration, not data — wiping your daily limits isn't what
      // "start over" means unless it's asked for explicitly.
      if (keep) await store.settings.update(keep);

      await refreshBadge();
      return { ok: true } as const;
    },

    "data:reset-track": async ({ track }) => {
      const store = await getStore();
      const cleared = await store.clearTrack(track);

      // The check-in and failure notes describe a history that no longer exists.
      await store.meta.remove(LAST_SEEN_KEY(track));
      await store.meta.remove(LAST_FAILURE_KEY(track));
      // A sync claimed by a tab that is still open would otherwise write the old history
      // straight back; releasing it lets the next page load start a fresh full walk.
      syncing.delete(track);
      lastAttemptAt.delete(track);

      await refreshBadge();
      return { cleared };
    },

    "schedule:rebuild": async ({ track }) => {
      // The rescheduler lives in core, where it can be tested against a store: it is the
      // one operation that rewrites due dates in bulk, and the version that lived here
      // read every problem row from *both* sites and keyed them by slug alone.
      const result = await rebuildTrackSchedule(await getStore(), track);
      await refreshBadge();
      return result;
    },

    "settings:get": async () => (await getStore()).settings.get(),

    "settings:patch-provider": async ({ provider, patch }) => {
      const next = await (await getStore()).settings.patchProvider(provider, patch);
      await refreshBadge();
      return next;
    },

    "settings:patch-track": async ({ track, patch }) => {
      const next = await (await getStore()).settings.patchTrack(track, patch);
      await refreshBadge();
      return next;
    },

    "settings:update": async ({ patch }) => {
      const next = await (await getStore()).settings.update(patch);
      // The badge counts the active track, so switching tracks changes what it should
      // say. Repainting on every settings write is cheaper than working out which
      // fields the badge depends on, and it can't go stale.
      await refreshBadge();
      return next;
    },

    "reviews:grade": async ({ track, slug, rating }) => {
      const store = await getStore();
      const [settings, card] = await Promise.all([
        store.settings.get(),
        store.cards.get(track, slug),
      ]);
      if (!card) throw new Error(`No review card for "${slug}" in the ${track} track`);

      const tuning = settings.tracks[track];
      const scheduler = createScheduler({ requestRetention: tuning.requestRetention });
      const now = Date.now();
      const { card: next, log } = scheduler.review(card, rating, now);

      // A problem the catalogue doesn't know sits in the middle rather than skipping the
      // floor entirely — no difficulty is not the same as no opinion.
      const catalog = await getCatalog().catch(() => null);
      const difficulty = catalog?.bySlug(slug)?.difficulty ?? "Medium";
      const locked = withMinimumLock(next, tuning.minimumLockDays[difficulty], now);

      await store.cards.put([locked]);
      await store.logs.append([log]);
      await refreshBadge();

      return { nextDue: locked.due };
    },
  });
});

/**
 * Flatten cards into the shape the panel renders, resolving titles, difficulty and the
 * outbound link.
 *
 * Shared by the queue and the browse list so the two can't drift — a problem that reads
 * one way in the queue and another in the list is worse than either.
 */
async function toReviewItems(
  cards: readonly ReviewCard[],
  track: TrackId,
  linkTarget: ProviderId,
  now: number,
): Promise<ReviewItem[]> {
  const store = await getStore();
  // Scoped to the track's own provider: its attempt counts and dates, nobody else's.
  const states = await store.problems.getMany(track, cards.map((card) => card.slug));
  const byslug = new Map(states.map((state) => [state.slug, state]));

  // Slugs are LeetCode titleSlugs, so the bundled catalog resolves real titles,
  // difficulty, and tags. Falls back gracefully for anything not in it.
  const [catalog, links] = await Promise.all([getCatalog().catch(() => null), getProblemLinks()]);

  return cards.map((card) => {
    const state = byslug.get(card.slug);
    const problem = catalog?.bySlug(card.slug);
    const link = links.resolve(card.slug, linkTarget);
    return {
      slug: card.slug,
      title: problem?.title ?? titleFromSlug(card.slug),
      due: card.due,
      overdueDays: (now - card.due) / MS_PER_DAY,
      attempts: state?.attempts ?? 0,
      lastSolvedAt: state?.lastSolvedAt ?? null,
      reps: card.reps,
      difficulty: problem?.difficulty ?? null,
      topicTags: problem?.topicTags.slice(0, 2) ?? [],
      url: link.href,
      site: link.site,
    };
  });
}

/**
 * Update one provider's settings without disturbing the other's.
 *
 * A one-line wrapper now that the store takes the provider by name. It used to read every
 * provider's settings and write them all back, which meant a sync timestamp landing here
 * could revive a source the user had just switched off on the options page.
 */
async function patchProvider(
  provider: ProviderId,
  patch: Partial<Settings["providers"][ProviderId]>,
): Promise<void> {
  await (await getStore()).settings.patchProvider(provider, patch);
}

/** Fetched from static assets on first use, not bundled — see lib/catalog.ts. */
async function getCatalogStats(): Promise<{ count: number; generatedAt: string | null }> {
  try {
    const catalog = await getCatalog();
    return { count: catalog.problems.length, generatedAt: catalog.generatedAt };
  } catch (error) {
    console.error("[lcs] catalog unavailable", error);
    return { count: 0, generatedAt: null };
  }
}

/**
 * The status every surface polls, memoised for a moment.
 *
 * Three surfaces poll this — the popup every two seconds, the side panel every five, the
 * options page on open — and they overlap constantly. The window is short enough that
 * nothing visibly lags and any write clears it outright, via `refreshBadge`.
 */
let statusCache: { at: number; value: SyncStatus } | null = null;
const STATUS_TTL_MS = 1_000;

function invalidateStatus(): void {
  statusCache = null;
}

async function buildStatus(): Promise<SyncStatus> {
  const cached = statusCache;
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;

  const store = await getStore();
  const now = Date.now();
  const [settings, catalog] = await Promise.all([store.settings.get(), getCatalogStats()]);

  const providers: ProviderStatus[] = await Promise.all(
    ACTIVE_PROVIDERS.map(async (id) => {
      const [lastSeenAt, lastFailure] = await Promise.all([
        store.meta.get<number>(LAST_SEEN_KEY(id)),
        store.meta.get<SyncFailure>(LAST_FAILURE_KEY(id)),
      ]);
      return {
        provider: id,
        // Derived from a timestamp that survives the worker being evicted, rather than
        // from a Set that did not.
        connected: lastSeenAt !== undefined && now - lastSeenAt < CONNECTED_WINDOW_MS,
        lastSeenAt: lastSeenAt ?? null,
        username: settings.providers[id].username,
        enabled: settings.providers[id].enabled,
        lastFullSyncAt: settings.providers[id].lastFullSyncAt,
        lastIncrementalSyncAt: settings.providers[id].lastIncrementalSyncAt,
        lastFailure: lastFailure ?? null,
      };
    }),
  );

  // Every number here is scoped to one track and counted through an index. There is no
  // total spanning both: the two sites are two schedules, and a figure sitting between
  // them belongs to neither — which is also why nothing in the interface asked for one.
  const tracks = {} as SyncStatus["tracks"];
  await Promise.all(
    TRACK_IDS.map(async (track) => {
      const [tracked, due, events, solved] = await Promise.all([
        store.cards.count(track),
        store.cards.countDue(track, now),
        store.events.count(track),
        store.problems.countSolved(track),
      ]);
      tracks[track] = { tracked, solved, due, events };
    }),
  );

  const value: SyncStatus = {
    running: false,
    providers,
    tracks,
    activeTrack: settings.activeTrack,
    catalog,
  };
  statusCache = { at: Date.now(), value };
  return value;
}

/**
 * Badge shows how many reviews are due, which is the only number worth interrupting for.
 *
 * Scoped to the active track: the badge has to agree with what the panel shows when you
 * open it, and a total spanning both tracks would send you looking for reviews that
 * aren't in the one you're working.
 */
async function refreshBadge(): Promise<void> {
  // Every write path calls this, so it is also where the status memo is dropped.
  invalidateStatus();
  try {
    const store = await getStore();
    const { activeTrack } = await store.settings.get();
    const due = await store.cards.countDue(activeTrack, Date.now());
    // "99+" rather than a flat "99": a backlog of 400 that reads as 99 looks like the
    // count is stuck, and the badge is four characters wide for exactly this.
    const text = due === 0 ? "" : due > 99 ? "99+" : String(due);
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  } catch (error) {
    console.error("[lcs] badge refresh failed", error);
  }
}
