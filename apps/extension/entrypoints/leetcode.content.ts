import type { ProgressEvent } from "@lcs/core";
import {
  type SyncCtx,
  checkToEvent,
  createThrottle,
  detectAuth,
  fullSync,
  incrementalSync,
  isSubmissionCheckUrl,
  parseSubmissionCheck,
  slugFromProblemUrl,
  submissionIdFromCheckUrl,
} from "@lcs/providers";

import { createLeetcodeTransport } from "../lib/leetcode-transport.js";
import { type SyncMode, send } from "../lib/messaging.js";
import { isPageObservation } from "../lib/page-bridge.js";

/**
 * ISOLATED world on leetcode.com.
 *
 * Two jobs, both running against the session you're already signed in with:
 *
 *   - **History.** Walks `/api/submissions/` for real solve dates and attempt counts,
 *     then backfills the accepted set for anything the history didn't reach. This is what
 *     NeetCode can't give us: NeetCode knows *that* you solved something, LeetCode knows
 *     *when*, and spaced repetition is only as good as those dates.
 *   - **Live verdicts.** Relays the judge's result the moment a submission is decided,
 *     from the MAIN-world observer.
 *
 * Every request is same-origin and throttled. The extension never handles a credential —
 * the session cookie rides along because this code runs on leetcode.com, which is the
 * same reason it can't be done from the background worker.
 */

/** Spacing between round trips. A full history walk should read like browsing, not scraping. */
const THROTTLE_MS = 1_100;
const THROTTLE_JITTER_MS = 400;

export default defineContentScript({
  matches: ["https://leetcode.com/*"],
  runAt: "document_idle",
  async main(ctx) {
    const transport = createLeetcodeTransport();

    // The verdict relay is set up first and unconditionally: it costs nothing, and a
    // submission landing while a slow sync is still running shouldn't be missed.
    watchForVerdicts();

    const auth = await detectAuth(transport);
    await send("provider:hello", {
      provider: "leetcode",
      url: location.href,
      username: auth.signedIn ? auth.username : null,
    }).catch(() => {});

    if (!auth.signedIn) return;

    // `ctx` aborts when the content script is invalidated — an extension reload, or a
    // navigation that tears down the document. Without it a full sync would keep paging
    // against a dead message channel.
    await syncIfClaimed(transport, ctx.signal);
  },
});

async function syncIfClaimed(
  transport: ReturnType<typeof createLeetcodeTransport>,
  signal: AbortSignal,
): Promise<void> {
  const claim = await send("sync:claim", { provider: "leetcode" }).catch(() => null);
  if (!claim?.mode) return;

  const mode: SyncMode = claim.mode;
  const syncCtx: SyncCtx = {
    now: () => Date.now(),
    signal,
    throttle: createThrottle(THROTTLE_MS, THROTTLE_JITTER_MS),
    onProgress: (update) =>
      console.debug(`[lcs] leetcode ${update.phase}: ${update.fetched}`),
  };

  let inserted = 0;
  try {
    const stream =
      mode === "full"
        ? fullSync(transport, syncCtx)
        : incrementalSync(transport, syncCtx, claim.since);

    // Persisted batch by batch, not at the end: a full history walk takes minutes, and
    // losing all of it because the tab closed at minute nine would be its own bug.
    for await (const events of stream) {
      if (signal.aborted) break;
      const result = await send("events:ingest", { provider: "leetcode", events });
      inserted += result.inserted;
    }

    await send("sync:completed", { provider: "leetcode", mode });
    console.debug(`[lcs] leetcode ${mode} sync: ${inserted} new events`);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    // Reported rather than swallowed — a sync that silently stops looks identical to an
    // account with nothing new, and the side panel would show a stale "last synced".
    await send("sync:completed", { provider: "leetcode", mode, error }).catch(() => {});
    console.warn(`[lcs] leetcode ${mode} sync failed`, cause);
  }
}

/**
 * Relay the judge's verdict from the MAIN world.
 *
 * The check response carries no slug — the URL you're on is what identifies the problem,
 * and the submission id comes from the poll URL. Together they give the event a stable id
 * that a later history sync will produce again for the same submission, so it lands once.
 */
function watchForVerdicts(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isPageObservation(event.data)) return;

    const observation = event.data;
    if (observation.provider !== "leetcode") return;
    if (!isSubmissionCheckUrl(observation.url)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(observation.responseBody);
    } catch {
      return;
    }

    const check = parseSubmissionCheck(parsed);
    if (!check) return; // Still judging; LeetCode polls this until it isn't.

    const slug = slugFromProblemUrl(location.href);
    const submissionId = submissionIdFromCheckUrl(observation.url);
    if (!slug || !submissionId) return;

    const progressEvent: ProgressEvent = checkToEvent(
      check,
      slug,
      submissionId,
      observation.observedAt,
    );

    void send("events:ingest", { provider: "leetcode", events: [progressEvent] })
      .then(() => console.debug(`[lcs] ${slug}: ${check.verdict}`))
      .catch(() => {});
  });
}
