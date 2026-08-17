import { installNetworkObserver } from "../lib/network-observer.js";

/**
 * MAIN world on neetcode.io.
 *
 * Signed-in progress is expected to come from Firestore, so the filter covers the Google
 * APIs hosts alongside anything that looks like NeetCode's own backend. Broad on purpose
 * — P4 narrows it once the capture shows what actually carries progress.
 */
const OBSERVED_URLS = /firestore|googleapis|firebaseio|\/api\/|graphql/i;

export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installNetworkObserver("neetcode", OBSERVED_URLS);
  },
});
