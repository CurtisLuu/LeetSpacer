import type { ProviderId } from "@lcs/core";

/**
 * The MAIN-world <-> ISOLATED-world channel.
 *
 * MAIN-world scripts can see the page's own network traffic but have no access to
 * extension APIs; ISOLATED-world scripts are the reverse. They meet here, over
 * `window.postMessage`, with a namespaced type so we never confuse our messages with
 * the host page's.
 */
export const BRIDGE_MESSAGE = "lcs:page-observation";

export interface PageObservation {
  type: typeof BRIDGE_MESSAGE;
  provider: ProviderId;
  url: string;
  method: string;
  status: number;
  /**
   * Request body, truncated. For GraphQL this holds the query text and variables —
   * the single most useful thing to capture, since it names the operation we need
   * to reimplement.
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

export function isPageObservation(value: unknown): value is PageObservation {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === BRIDGE_MESSAGE
  );
}
