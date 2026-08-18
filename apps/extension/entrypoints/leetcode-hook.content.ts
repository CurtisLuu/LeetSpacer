import { isSubmissionCheckUrl } from "@lcs/providers";

import { installNetworkObserver } from "../lib/network-observer.js";
import { acceptPageBridge } from "../lib/page-bridge.js";

/**
 * MAIN world on leetcode.com.
 *
 * Exists for one thing: the judge poll LeetCode runs after you hit Submit. That response
 * is the only place a verdict appears the moment it's decided, and it's fetched by the
 * page itself — so watching it costs no request of our own and no waiting for a sync.
 *
 * The filter is the same predicate the ISOLATED world uses to recognise the response, so
 * the two cannot drift into observing more than is consumed. Everything else this adapter
 * needs it asks for directly from the ISOLATED world.
 *
 * Nothing is patched until the ISOLATED world reports consent, and `document_start` is
 * what puts the port handshake before the page's first script — see `lib/page-bridge.ts`.
 */
export default defineContentScript({
  matches: ["https://leetcode.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    acceptPageBridge((publish) => {
      installNetworkObserver("leetcode", isSubmissionCheckUrl, publish);
    });
  },
});
