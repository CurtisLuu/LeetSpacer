import {
  type ProviderId,
  type ReviewCard,
  type Settings,
  type Store,
  type TrackId,
  TRACK_IDS,
  createScheduler,
  distributeDueDates,
  ingestEvents,
  seedMissingCards,
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

/** Which provider tabs have checked in this browser session. */
const connected = new Set<ProviderId>();
const lastError = new Map<ProviderId, string>();

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
  // Clicking the toolbar icon opens the side panel, which is the main UI.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("[lcs] side panel behavior", error));

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
      connected.add(provider);
      lastError.delete(provider);
      if (username) await patchProvider(provider, { username });
      return { ack: true };
    },

    "events:ingest": async ({ provider, events, complete }) => {
      connected.add(provider);
      const store = await getStore();
      const result = await ingestEvents(store, events);

      if (result.inserted > 0) {
        await seedMissingCards(store);
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
    },

    "sync:status": async () => buildStatus(),

    "sync:claim": async ({ provider }) => {
      const declined = { mode: null, since: 0 } as const;
      const settings = await (await getStore()).settings.get();
      const state = settings.providers[provider];
      const now = Date.now();

      if (!state.enabled || syncing.has(provider)) return declined;

      const attempted = lastAttemptAt.get(provider);
      if (attempted !== undefined && now - attempted < INCREMENTAL_INTERVAL_MS) return declined;

      const since = state.lastFullSyncAt === null
        ? null
        : (state.lastIncrementalSyncAt ?? state.lastFullSyncAt);

      if (since !== null && now - since < INCREMENTAL_INTERVAL_MS) return declined;

      syncing.add(provider);
      lastAttemptAt.set(provider, now);
      return since === null ? { mode: "full", since: 0 } : { mode: "incremental", since };
    },

    "sync:completed": async ({ provider, mode, error }) => {
      syncing.delete(provider);
      const now = Date.now();

      if (error) {
        lastError.set(provider, error);
      } else {
        lastError.delete(provider);
        await patchProvider(provider, {
          lastIncrementalSyncAt: now,
          ...(mode === "full" ? { lastFullSyncAt: now } : {}),
        });
      }

      await refreshBadge();
      return { ok: true } as const;
    },

    "sync:run": async ({ provider, mode }) => {
      // Nothing to trigger from here: both providers read from a tab on their own origin,
      // and this worker has no `tabs` permission to reach into one. Reported honestly
      // rather than faking a sync.
      const where = provider === "neetcode" ? "neetcode.io/practice" : "leetcode.com";
      lastError.set(provider, `Open ${where} to sync — there is no manual ${mode} sync.`);
      return buildStatus();
    },

    "reviews:due": async ({ track, limit }) => {
      const store = await getStore();
      const now = Date.now();
      // Local midnight, not a rolling 24 hours: "today" has to mean the same thing to
      // the panel as it does to the person reading it.
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      const [settings, allDue, allCards, todaysLogs] = await Promise.all([
        store.settings.get(),
        store.cards.due(track, now),
        store.cards.all(track),
        store.logs.since(midnight.getTime()),
      ]);

      // Everything seeded but not yet due. Mostly the dateless backfill, which the
      // seeding strategy deliberately fans across a window instead of dumping at once.
      const waiting = allCards.filter((card) => card.due > now);
      const nextDueAt = waiting.reduce<number | null>(
        (soonest, card) => (soonest === null ? card.due : Math.min(soonest, card.due)),
        null,
      );

      const cap = limit ?? settings.tracks[track].dailyReviewLimit;
      // Most overdue first — those are the ones closest to being forgotten.
      const selected = [...allDue].sort((a, b) => a.due - b.due).slice(0, cap);

      const items = await toReviewItems(selected, track, settings.problemLinkTarget, now);

      return {
        items,
        totalDue: allDue.length,
        limit: cap,
        track,
        scheduledAhead: waiting.length,
        nextDueAt,
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

    "schedule:rebuild": async ({ track }) => {
      const result = await rebuildSchedule(await getStore(), track);
      await refreshBadge();
      return result;
    },

    "settings:get": async () => (await getStore()).settings.get(),

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

      const scheduler = createScheduler({
        requestRetention: settings.tracks[track].requestRetention,
      });
      const { card: next, log } = scheduler.review(card, rating, Date.now());

      await store.cards.put([next]);
      await store.logs.append([log]);
      await refreshBadge();

      return { nextDue: next.due };
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

/** Update one provider's settings without disturbing the other's. */
async function patchProvider(
  provider: ProviderId,
  patch: Partial<Settings["providers"][ProviderId]>,
): Promise<void> {
  const store = await getStore();
  const { providers } = await store.settings.get();
  await store.settings.update({
    providers: { ...providers, [provider]: { ...providers[provider], ...patch } },
  });
}

/**
 * Re-seed one track's schedule using its current settings.
 *
 * Scoped to a track because the settings being applied are: rebuilding the NeetCode track
 * has no business moving cards you've been working through on LeetCode.
 *
 * Only touches cards you've never graded — anything with review history is real data and
 * is left exactly where it is. Cards with a genuine solve date are re-seeded from it but
 * kept out of the redistribution, for the same reason seeding skips them.
 */
async function rebuildSchedule(
  store: Store,
  track: TrackId,
): Promise<{ rebuilt: number; kept: number }> {
  const settings = await store.settings.get();
  const tuning = settings.tracks[track];
  const scheduler = createScheduler({ requestRetention: tuning.requestRetention });
  const [cards, problems] = await Promise.all([store.cards.all(track), store.problems.all()]);
  const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));

  const dated: ReviewCard[] = [];
  const undated: ReviewCard[] = [];
  let kept = 0;

  for (const card of cards) {
    const reviewed = await store.logs.forProblem(track, card.slug);
    if (reviewed.length > 0) {
      kept += 1;
      continue;
    }
    const problem = bySlug.get(card.slug);
    if (!problem?.lastSolvedAt) continue;
    const seeded = scheduler.seed(
      track,
      card.slug,
      problem.lastSolvedAt,
      Math.max(1, problem.attempts),
    );
    (problem.hasDatedSolve ? dated : undated).push(seeded);
  }

  if (dated.length > 0 || undated.length > 0) {
    await store.cards.put([
      ...dated,
      ...distributeDueDates(undated, {
        strategy: tuning.seedStrategy,
        now: Date.now(),
        spreadDays: tuning.seedSpreadDays,
      }),
    ]);
  }

  return { rebuilt: dated.length + undated.length, kept };
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

async function buildStatus(): Promise<SyncStatus> {
  const store = await getStore();
  const now = Date.now();
  const [settings, catalog] = await Promise.all([store.settings.get(), getCatalogStats()]);

  const providers: ProviderStatus[] = ACTIVE_PROVIDERS.map((id) => ({
    provider: id,
    connected: connected.has(id),
    username: settings.providers[id].username,
    lastFullSyncAt: settings.providers[id].lastFullSyncAt,
    lastIncrementalSyncAt: settings.providers[id].lastIncrementalSyncAt,
    lastError: lastError.get(id) ?? null,
  }));

  // Reported for every track, not just the active one, so the selector can show what's
  // waiting in the track you're not looking at.
  const tracks = {} as SyncStatus["tracks"];
  let tracked = 0;
  let solved = 0;
  for (const track of TRACK_IDS) {
    const [cards, due, events, problems] = await Promise.all([
      store.cards.all(track),
      store.cards.due(track, now),
      // Scoped to the provider that feeds this track. A combined total sitting between
      // two track-scoped numbers reads as a bug, because it looks like one of the three
      // is counting something else — which it was.
      store.events.count(track),
      store.problems.all(track),
    ]);
    tracked += problems.length;
    solved += problems.filter((p) => p.status === "solved").length;
    tracks[track] = {
      tracked: cards.length,
      solved: problems.filter((p) => p.status === "solved").length,
      due: due.length,
      events,
    };
  }

  return {
    running: false,
    providers,
    tracks,
    activeTrack: settings.activeTrack,
    problemsTracked: tracked,
    solved,
    catalog,
  };
}

/**
 * Badge shows how many reviews are due, which is the only number worth interrupting for.
 *
 * Scoped to the active track: the badge has to agree with what the panel shows when you
 * open it, and a total spanning both tracks would send you looking for reviews that
 * aren't in the one you're working.
 */
async function refreshBadge(): Promise<void> {
  try {
    const store = await getStore();
    const { activeTrack } = await store.settings.get();
    const due = await store.cards.due(activeTrack, Date.now());
    const text = due.length === 0 ? "" : String(Math.min(due.length, 99));
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  } catch (error) {
    console.error("[lcs] badge refresh failed", error);
  }
}
