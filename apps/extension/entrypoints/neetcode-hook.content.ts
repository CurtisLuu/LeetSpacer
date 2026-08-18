import { isObservableNeetcodeUrl } from "@lcs/providers";

import { installNetworkObserver } from "../lib/network-observer.js";
import { acceptPageBridge } from "../lib/page-bridge.js";

/**
 * MAIN world on neetcode.io.
 *
 * Watches exactly one endpoint: `POST /api/callableFunctionHttp`, which carries both the
 * completed-problem set the page fetches on load and the bearer token the activity walk
 * borrows. `isObservableNeetcodeUrl` is an allow-list of that path on neetcode.io's own
 * host — see `@lcs/providers` for what the earlier substring filter matched by accident.
 *
 * Nothing is patched here on load. The observer is installed only once the ISOLATED world
 * says the privacy policy has been accepted and this source is switched on, so a page
 * visited before consent has its requests left entirely alone.
 *
 * `document_start` is load-bearing, not a performance choice: it is what puts the port
 * handshake before the page's first script. See `lib/page-bridge.ts`.
 */
export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    acceptPageBridge((publish) => {
      installNetworkObserver("neetcode", (url) => isObservableNeetcodeUrl(url, location.origin), publish);
    });
  },
});
