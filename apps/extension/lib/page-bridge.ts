import type { ProviderId } from "@lcs/core";

/**
 * The MAIN-world <-> ISOLATED-world channel.
 *
 * MAIN-world scripts can see the page's own network traffic but have no access to
 * extension APIs; ISOLATED-world scripts are the reverse. They meet here.
 *
 * They meet over a **private `MessageChannel`**, not over `window.postMessage`. The
 * distinction is the whole point: `window` is shared with the page, so every script
 * running on neetcode.io — the site's own bundles, anything they load, an XSS on the
 * origin — sees every message posted to it, whatever `targetOrigin` says. `targetOrigin`
 * picks the document, not the script. Broadcasting there put the page's live bearer token
 * on a bus that any listener could read, and let any listener forge an observation back.
 *
 * A port has exactly two ends. Once the two worlds hold one each, nothing else on the
 * page can read what crosses it or write into it.
 *
 * Handing the port over is the one moment that has to happen on `window`, and it is safe
 * for one reason only: **both content scripts run at `document_start`, before the page's
 * first script executes**, so there is no page listener in existence to intercept the
 * offer. That is a load-bearing property — see the run-at note on each content script.
 * The offer is made once and never repeated, so there is no later window in which a page
 * script could ask for a port of its own.
 *
 * The offer travels ISOLATED -> MAIN, deliberately. If the timing assumption above were
 * ever wrong, a page script that stole the port would be able to feed the extension junk
 * observations (bounded: slugs are validated downstream and nothing is exfiltrated) —
 * where an offer made the other way would have handed it the token instead. Fail towards
 * the cheaper loss.
 */
export interface PageObservation {
  provider: ProviderId;
  url: string;
  method: string;
  status: number;
  /**
   * Request body, truncated. For a NeetCode callable this names the function, which is
   * how the completed-set response is told apart from every other call.
   */
  requestBody: string;
  /** Response body, truncated. Empty when the body wasn't readable. */
  responseBody: string;
  /**
   * The request's `Authorization` header, when it carried one.
   *
   * Relayed because NeetCode's endpoints are Firebase callables: they take a bearer token
   * that expires hourly, and the copy sitting in the page's storage is routinely stale.
   * The one the page just used is by definition the one that works.
   *
   * This is the field that makes the private channel non-negotiable.
   */
  authorization?: string;
  observedAt: number;
}

/**
 * Bodies are inspected for shapes, verdicts, and progress data. Large enough that a full
 * completed-problems response survives intact — a truncated capture is worse than none,
 * because it looks like data right up until it fails to parse.
 */
export const MAX_BODY_CHARS = 250_000;

/** The `window` message that carries the port. Namespaced so the page's own traffic can't collide. */
const PORT_OFFER = "lcs:bridge-port";

/** What crosses the port, in both directions. */
type BridgeMessage =
  | { kind: "ready" }
  | { kind: "observe" }
  | { kind: "observation"; observation: PageObservation };

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "ready" || kind === "observe" || kind === "observation";
}

/**
 * How long to wait for the MAIN world to take the port before saying so.
 *
 * The handshake depends on the MAIN-world script being injected first, which the manifest
 * order guarantees today. If that ever stops being true the failure is silent — no
 * verdicts, no NeetCode token, no error — so it gets a console line rather than nothing.
 */
const HANDSHAKE_TIMEOUT_MS = 5_000;

function isPageObservation(value: unknown): value is PageObservation {
  if (typeof value !== "object" || value === null) return false;
  const observation = value as Partial<PageObservation>;
  return (
    typeof observation.provider === "string" &&
    typeof observation.url === "string" &&
    typeof observation.method === "string" &&
    typeof observation.status === "number" &&
    typeof observation.requestBody === "string" &&
    typeof observation.responseBody === "string" &&
    typeof observation.observedAt === "number" &&
    (observation.authorization === undefined || typeof observation.authorization === "string")
  );
}

/** The ISOLATED-world end of the bridge. */
export interface PageBridge {
  /** Called for each observation the MAIN world relays. */
  onObservation(handler: (observation: PageObservation) => void): void;
  /**
   * Let the MAIN world start watching the page's requests.
   *
   * Nothing is patched, and so nothing is observed, until this is called — which happens
   * only after the privacy policy has been accepted and the source is switched on. The
   * consent check lives in this world because only this world can ask the background.
   */
  observe(): void;
}

/**
 * Open the bridge from the ISOLATED world. Call at the top of a `document_start` script.
 */
export function openPageBridge(): PageBridge {
  const handlers: ((observation: PageObservation) => void)[] = [];
  const channel = new MessageChannel();
  let observing = false;
  let connected = false;

  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    // Shape-checked rather than trusted: cheap, and the port is only as trustworthy as
    // the handshake above.
    if (!isBridgeMessage(message)) return;
    if (message.kind === "ready") {
      connected = true;
      return;
    }
    if (message.kind !== "observation") return;
    if (!isPageObservation(message.observation)) return;
    for (const handler of handlers) {
      try {
        handler(message.observation);
      } catch (cause) {
        console.warn("[lcs] observation handler", cause);
      }
    }
  };
  channel.port1.start();

  // Made once, synchronously, before any page script exists to hear it.
  //
  // Guarded because this runs at module scope in a content script: a throw here would
  // take the whole script down, and with it the passive reads that need no observer at
  // all. A bridge that fails to open costs the verdict relay, not the extension.
  try {
    window.postMessage({ type: PORT_OFFER }, location.origin, [channel.port2]);
  } catch (cause) {
    console.warn("[lcs] page bridge: could not offer the port", cause);
  }

  return {
    onObservation(handler) {
      handlers.push(handler);
    },
    observe() {
      if (observing) return;
      observing = true;
      channel.port1.postMessage({ kind: "observe" } satisfies BridgeMessage);
      setTimeout(() => {
        if (connected) return;
        console.warn(
          "[lcs] page bridge: the MAIN-world script never took the port — check that its content script is still declared first in the manifest",
        );
      }, HANDSHAKE_TIMEOUT_MS);
    },
  };
}

/**
 * Take the ISOLATED world's port from the MAIN world.
 *
 * `onObserve` runs when — and only when — the other end says consent is in place. It is
 * handed the function that publishes an observation back over the port.
 */
export function acceptPageBridge(
  onObserve: (publish: (observation: PageObservation) => void) => void,
): void {
  window.addEventListener("message", function accept(event: MessageEvent<unknown>) {
    // Same document only: an embedded frame posting up cannot pass for the offer.
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    if ((event.data as { type?: unknown } | null)?.type !== PORT_OFFER) return;

    const port = event.ports[0];
    if (!port) return;

    // One port, one time. Nothing offered later is accepted, so a page script that starts
    // posting offers after load gets no channel of its own.
    window.removeEventListener("message", accept);

    // Acknowledged so the other end can tell "not consented yet" from "never connected".
    port.postMessage({ kind: "ready" } satisfies BridgeMessage);

    port.onmessage = (portEvent: MessageEvent<unknown>) => {
      if (!isBridgeMessage(portEvent.data) || portEvent.data.kind !== "observe") return;
      port.onmessage = null;
      onObserve((observation) => {
        try {
          port.postMessage({ kind: "observation", observation } satisfies BridgeMessage);
        } catch {
          // Never let observation break the page.
        }
      });
    };
    port.start();
  });
}
