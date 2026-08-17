import {
  PROGRESS_CACHE_KEY,
  type NeetcodeSyncCtx,
  completedToEvents,
  createThrottle,
  isCompletedProblemsCall,
  neetcodeSync,
  parseCompletedProblems,
} from "@lcs/providers";

import { type SyncMode, send } from "../lib/messaging.js";
import { createNeetcodeTransport } from "../lib/neetcode-transport.js";
import { isPageObservation } from "../lib/page-bridge.js";

/**
 * ISOLATED world on neetcode.io.
 *
 * Reads which problems you've completed, from two places the page provides on its own:
 * the `getCompletedProblems` response it fetches on load, and the `synced-progress-cache`
 * it keeps in localStorage. Neither costs a request — the data is already there by the
 * time this runs.
 *
 * Both surfaces identify problems by LeetCode URL, so everything downstream is keyed by
 * LeetCode slug and joins straight to the bundled catalog.
 *
 * On top of that passive read, it walks NeetCode's own activity history for the thing the
 * completed set can't provide: per-submission dates and verdicts. That walk does issue
 * requests and does use the page's Firebase token — see `lib/neetcode-transport.ts` for
 * why there's no way around it and what the token is and isn't used for.
 */

/**
 * The bearer token last seen on one of the page's own callable requests.
 *
 * Held here rather than read from Firebase's storage, where the stored copy expires hourly
 * and is usually stale. Kept in memory only, for the life of the tab.
 */
let observedToken: string | null = null;

/** Resolves once the page has made an authenticated call we could learn from. */
function waitForSession(signal: AbortSignal): Promise<boolean> {
  if (observedToken) return Promise.resolve(true);

  return new Promise((resolve) => {
    // The page fetches its completed set on load, so this normally lands within a second
    // or two. The cap is for the signed-out case, where it never will.
    const deadline = Date.now() + 20_000;
    const timer = setInterval(() => {
      if (observedToken) {
        clearInterval(timer);
        resolve(true);
      } else if (signal.aborted || Date.now() > deadline) {
        clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

/** Spacing between round trips, matching the LeetCode walk. */
const THROTTLE_MS = 1_100;
const THROTTLE_JITTER_MS = 400;

export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  // document_start so the bridge listener exists before the page's load-time requests.
  runAt: "document_start",
  async main(ctx) {
    // Nothing in here may throw. WXT awaits `main`, and an escaping rejection takes the
    // whole content script down — including the passive completed-set read, which works
    // with or without any of the activity machinery.
    try {
      await send("provider:hello", { provider: "neetcode", url: location.href }).catch(() => {});
      watchForProgress();
      await syncActivity(ctx.signal);
    } catch (cause) {
      console.warn("[lcs] neetcode content script", cause);
    }
  },
});

/**
 * Walk NeetCode's submission history.
 *
 * Claimed through the background like LeetCode's, so two open tabs don't both walk it and
 * a failure doesn't retry on every page load.
 */
async function syncActivity(signal: AbortSignal): Promise<void> {
  const claim = await send("sync:claim", { provider: "neetcode" }).catch(() => null);
  if (!claim?.mode) return;

  const mode: SyncMode = claim.mode;

  // The page authenticates itself after this script starts, so there is nothing to
  // borrow yet. Waits for it to make a call of its own.
  if (!(await waitForSession(signal))) {
    await send("sync:completed", {
      provider: "neetcode",
      mode,
      error: "Not signed in to neetcode.io — only completed problems could be read.",
    }).catch(() => {});
    return;
  }

  // Every submission is keyed through this, so an empty map would walk the whole history
  // and discard all of it. Better to stop and say why.
  const { byNeetcodeSlug } = await send("catalog:neetcode-slugs", {}).catch(() => ({
    byNeetcodeSlug: {},
  }));
  const slugs = new Map(Object.entries(byNeetcodeSlug));

  if (slugs.size === 0) {
    const error = "No NeetCode slug map — run pnpm neetcode:map and rebuild.";
    await send("sync:completed", { provider: "neetcode", mode, error }).catch(() => {});
    console.warn(`[lcs] ${error}`);
    return;
  }

  const transport = createNeetcodeTransport(() => observedToken);
  const syncCtx: NeetcodeSyncCtx = {
    now: () => Date.now(),
    signal,
    throttle: createThrottle(THROTTLE_MS, THROTTLE_JITTER_MS),
    toLeetcodeSlug: (neetcodeSlug) => slugs.get(neetcodeSlug) ?? null,
    onProgress: (update) => console.debug(`[lcs] neetcode ${update.phase}: ${update.fetched}`),
  };

  let inserted = 0;
  const touched = new Set<string>();

  try {
    const stream =
      mode === "full"
        ? neetcodeSync.fullSync(transport, syncCtx)
        : neetcodeSync.incrementalSync(transport, syncCtx, claim.since);

    for await (const events of stream) {
      if (signal.aborted) break;
      const result = await send("events:ingest", { provider: "neetcode", events });
      inserted += result.inserted;
      for (const slug of result.updatedProblems) touched.add(slug);
    }

    await send("sync:completed", { provider: "neetcode", mode });
    console.debug(
      `[lcs] neetcode ${mode} sync: ${inserted} new events across ${touched.size} problems`,
    );
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    // Not fatal: the completed set still keeps the track populated, just without dates.
    await send("sync:completed", { provider: "neetcode", mode, error }).catch(() => {});
    console.warn(`[lcs] neetcode ${mode} activity sync failed`, cause);
  }
}

/** Slugs already sent this page-load, so navigating around doesn't re-send constantly. */
let lastSent = "";

function ingest(raw: unknown, source: string): void {
  const completed = parseCompletedProblems(raw);
  if (completed.length === 0) return;

  const fingerprint = completed
    .map((problem) => problem.slug)
    .sort()
    .join(",");
  if (fingerprint === lastSent) return;
  lastSent = fingerprint;

  const events = completedToEvents(completed, Date.now());
  // The completed set is the whole set every time, but it is no longer the only NeetCode
  // path — the activity walk marks completion, so this one no longer claims to.
  void send("events:ingest", { provider: "neetcode", events })
    .then((result) => {
      console.debug(`[lcs] ${source}: ${completed.length} completed, ${result.inserted} new`);
    })
    .catch(() => {});
}

function watchForProgress(): void {
  // The response the page fetches for itself, relayed from the MAIN-world observer.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isPageObservation(event.data)) return;

    const observation = event.data;
    if (observation.authorization) observedToken = observation.authorization;

    if (!isCompletedProblemsCall(observation.requestBody)) return;

    try {
      ingest(JSON.parse(observation.responseBody), "api");
    } catch {
      // A truncated or unexpected body isn't worth surfacing; the cache path covers us.
    }
  });

  // The copy already in localStorage, which works even offline or on a cached load.
  const readCache = () => {
    try {
      const raw = localStorage.getItem(PROGRESS_CACHE_KEY);
      if (raw) ingest(JSON.parse(raw), "cache");
    } catch {
      // Not available yet, or not JSON.
    }
  };

  // NeetCode writes the cache after its first fetch resolves, so one read at startup
  // usually misses it on a cold load.
  readCache();
  for (const delay of [1_000, 3_000, 8_000]) setTimeout(readCache, delay);

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    readCache();
  }, 1_500);
}
