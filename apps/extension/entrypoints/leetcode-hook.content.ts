import { installNetworkObserver } from "../lib/network-observer.js";

/**
 * MAIN world on leetcode.com.
 *
 * Exists for one thing: the judge poll LeetCode runs after you hit Submit. That response
 * is the only place a verdict appears the moment it's decided, and it's fetched by the
 * page itself — so watching it costs no request of our own and no waiting for a sync.
 *
 * The filter is deliberately narrow. A broad one would relay the page's GraphQL traffic
 * into the extension for no reason; everything else this adapter needs it asks for
 * directly from the ISOLATED world.
 */
const OBSERVED_URLS = /\/submissions\/detail\/\d+\/check/i;

export default defineContentScript({
  matches: ["https://leetcode.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installNetworkObserver("leetcode", OBSERVED_URLS);
  },
});
