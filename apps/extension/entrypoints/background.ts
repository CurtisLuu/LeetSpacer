import {
  type ProviderId,
  type Store,
  createScheduler,
  distributeDueDates,
  ingestEvents,
} from "@lcs/core";

import { getCatalog } from "../lib/catalog.js";
import { titleFromSlug } from "../lib/format.js";
import { type ProviderStatus, type ReviewItem, type SyncStatus, onMessage } from "../lib/messaging.js";
import { getStore } from "../lib/store.js";

/**
 * Providers with a working data path today. LeetCode is deferred until its adapter is
 * sorted out, so it isn't advertised in the UI or asked for as a permission.
 */
const ACTIVE_PROVIDERS: ProviderId[] = ["neetcode"];

const SYNC_ALARM = "lcs:incremental-sync";
const SYNC_PERIOD_MINUTES = 60 * 6;
const MS_PER_DAY = 86_400_000;

/** Which provider tabs have checked in this browser session. */
const connected = new Set<ProviderId>();
const lastError = new Map<ProviderId, string>();

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel, which is the main UI.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("[lcs] side panel behavior", error));

  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    void refreshBadge();
  });

  void refreshBadge();

  onMessage({
    "provider:hello": async ({ provider }) => {
      connected.add(provider);
      lastError.delete(provider);
      return { ack: true };
    },

    "events:ingest": async ({ provider, events }) => {
      connected.add(provider);
      const store = await getStore();
      const result = await ingestEvents(store, events);

      if (result.inserted > 0) {
        await seedMissingCards(store);
        await store.settings.update({
          providers: {
            ...(await store.settings.get()).providers,
            [provider]: {
              ...(await store.settings.get()).providers[provider],
              lastFullSyncAt: Date.now(),
              lastIncrementalSyncAt: Date.now(),
            },
          },
        });
        await refreshBadge();
      }

      return result;
    },

    "sync:status": async () => buildStatus(),

    "sync:run": async ({ provider, mode }) => {
      // Nothing to trigger: NeetCode progress arrives on its own whenever a
      // neetcode.io tab is open. Reported honestly rather than faking a sync.
      lastError.set(
        provider,
        `Open neetcode.io/practice to sync — there is no manual ${mode} sync.`,
      );
      return buildStatus();
    },

    "reviews:due": async ({ limit }) => {
      const store = await getStore();
      const [settings, allDue] = await Promise.all([
        store.settings.get(),
        store.cards.due(Date.now()),
      ]);

      const cap = limit ?? settings.dailyReviewLimit;
      const now = Date.now();
      // Most overdue first — those are the ones closest to being forgotten.
      const selected = [...allDue].sort((a, b) => a.due - b.due).slice(0, cap);
      const states = await store.problems.getMany(selected.map((card) => card.slug));
      const byslug = new Map(states.map((state) => [state.slug, state]));

      // Slugs are LeetCode titleSlugs, so the bundled catalog resolves real titles,
      // difficulty, and tags. Falls back gracefully for anything not in it.
      const catalog = await getCatalog().catch(() => null);

      const items: ReviewItem[] = selected.map((card) => {
        const state = byslug.get(card.slug);
        const problem = catalog?.bySlug(card.slug);
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
          url: `https://leetcode.com/problems/${card.slug}/`,
        };
      });

      return { items, totalDue: allDue.length, limit: cap };
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

    "schedule:rebuild": async () => {
      const result = await rebuildSchedule(await getStore());
      await refreshBadge();
      return result;
    },

    "settings:get": async () => (await getStore()).settings.get(),

    "settings:update": async ({ patch }) => (await getStore()).settings.update(patch),

    "reviews:grade": async ({ slug, rating }) => {
      const store = await getStore();
      const [settings, card] = await Promise.all([store.settings.get(), store.cards.get(slug)]);
      if (!card) throw new Error(`No review card for "${slug}"`);

      const scheduler = createScheduler({ requestRetention: settings.requestRetention });
      const { card: next, log } = scheduler.review(card, rating, Date.now());

      await store.cards.put([next]);
      await store.logs.append([log]);
      await refreshBadge();

      return { nextDue: next.due };
    },
  });
});

/**
 * Give every solved problem a review card, without disturbing ones that already have
 * one. Re-running a sync must never reset a schedule you've been building.
 */
async function seedMissingCards(store: Store): Promise<number> {
  const settings = await store.settings.get();
  const scheduler = createScheduler({ requestRetention: settings.requestRetention });
  const solved = (await store.problems.all()).filter(
    (problem) => problem.status === "solved" && problem.lastSolvedAt !== null,
  );

  const seeded = [];
  for (const problem of solved) {
    if (await store.cards.get(problem.slug)) continue;
    seeded.push(scheduler.seed(problem.slug, problem.lastSolvedAt!, Math.max(1, problem.attempts)));
  }

  if (seeded.length === 0) return 0;

  await store.cards.put(
    distributeDueDates(seeded, {
      strategy: settings.seedStrategy,
      now: Date.now(),
      spreadDays: settings.seedSpreadDays,
    }),
  );
  return seeded.length;
}

/**
 * Re-seed the schedule using the current settings.
 *
 * Only touches cards you've never graded — anything with review history is real data and
 * is left exactly where it is.
 */
async function rebuildSchedule(store: Store): Promise<{ rebuilt: number; kept: number }> {
  const settings = await store.settings.get();
  const scheduler = createScheduler({ requestRetention: settings.requestRetention });
  const [cards, problems] = await Promise.all([store.cards.all(), store.problems.all()]);
  const bySlug = new Map(problems.map((problem) => [problem.slug, problem]));

  const untouched = [];
  let kept = 0;

  for (const card of cards) {
    const reviewed = await store.logs.forProblem(card.slug);
    if (reviewed.length > 0) {
      kept += 1;
      continue;
    }
    const problem = bySlug.get(card.slug);
    if (!problem?.lastSolvedAt) continue;
    untouched.push(scheduler.seed(card.slug, problem.lastSolvedAt, Math.max(1, problem.attempts)));
  }

  if (untouched.length > 0) {
    await store.cards.put(
      distributeDueDates(untouched, {
        strategy: settings.seedStrategy,
        now: Date.now(),
        spreadDays: settings.seedSpreadDays,
      }),
    );
  }

  return { rebuilt: untouched.length, kept };
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
  const [settings, problems, eventsRecorded, catalog] = await Promise.all([
    store.settings.get(),
    store.problems.all(),
    store.events.count(),
    getCatalogStats(),
  ]);

  const providers: ProviderStatus[] = ACTIVE_PROVIDERS.map((id) => ({
    provider: id,
    connected: connected.has(id),
    username: settings.providers[id].username,
    lastFullSyncAt: settings.providers[id].lastFullSyncAt,
    lastIncrementalSyncAt: settings.providers[id].lastIncrementalSyncAt,
    lastError: lastError.get(id) ?? null,
  }));

  return {
    running: false,
    providers,
    problemsTracked: problems.length,
    solved: problems.filter((p) => p.status === "solved").length,
    eventsRecorded,
    catalog,
  };
}

/** Badge shows how many reviews are due, which is the only number worth interrupting for. */
async function refreshBadge(): Promise<void> {
  try {
    const store = await getStore();
    const due = await store.cards.due(Date.now());
    const text = due.length === 0 ? "" : String(Math.min(due.length, 99));
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  } catch (error) {
    console.error("[lcs] badge refresh failed", error);
  }
}
