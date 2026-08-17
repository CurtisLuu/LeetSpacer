import {
  PROGRESS_CACHE_KEY,
  completedToEvents,
  isCompletedProblemsCall,
  parseCompletedProblems,
} from "@lcs/providers";

import { send } from "../lib/messaging.js";
import { isPageObservation } from "../lib/page-bridge.js";

/**
 * ISOLATED world on neetcode.io.
 *
 * Reads which problems you've completed, from two places the page provides on its own:
 * the `getCompletedProblems` response it fetches on load, and the `synced-progress-cache`
 * it keeps in localStorage. We issue no requests and never handle an auth token — the
 * data is already there by the time this runs.
 *
 * Both surfaces identify problems by LeetCode URL, so everything downstream is keyed by
 * LeetCode slug and joins straight to the bundled catalog.
 */
export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  // document_start so the bridge listener exists before the page's load-time requests.
  runAt: "document_start",
  async main() {
    await send("provider:hello", { provider: "neetcode", url: location.href }).catch(() => {});
    watchForProgress();
  },
});

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
