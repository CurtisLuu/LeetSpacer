import type { ProviderId } from "@lcs/core";

import { MAX_BODY_CHARS, type PageObservation } from "./page-bridge.js";

/** Publishes one observation to the ISOLATED world, over the private port. */
export type PublishObservation = (observation: PageObservation) => void;

/** Which requests may be looked at. An allow-list, never a "looks interesting" match. */
export type UrlFilter = (url: string) => boolean;

/**
 * Watches the requests the page itself makes, from the MAIN world.
 *
 * This is how we learn about an accepted submission the moment it happens, and how the
 * NeetCode adapter borrows the token the page just used — without polling and without
 * issuing a single request of our own. It is strictly passive: every wrapper returns the
 * original value untouched, and any failure inside our observation code is swallowed so
 * it can never break the host page.
 *
 * Two things bound what it can see, and both are the caller's responsibility:
 *
 *   - `urlFilter` decides what is looked at *at all*. A request that does not match is
 *     never read, never cloned, and never published. Keep it to the exact endpoints the
 *     adapter consumes — a filter that merely looks specific will one day match a sign-in.
 *   - Nothing is patched until this is called, and the callers only call it once the
 *     privacy policy has been accepted and the source is switched on.
 */
export function installNetworkObserver(
  provider: ProviderId,
  urlFilter: UrlFilter,
  publish: PublishObservation,
): void {
  const emit = (observation: PageObservation) => {
    try {
      publish(observation);
    } catch {
      // Never let observation break the page.
    }
  };

  const truncate = (body: string) => body.slice(0, MAX_BODY_CHARS);

  const matches = (url: string) => {
    try {
      return urlFilter(url);
    } catch {
      // A filter that throws observes nothing. Failing closed is the only safe direction.
      return false;
    }
  };

  // --- fetch ---------------------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
    // Read the request body *before* awaiting, while the Request is still intact.
    let requestBody = "";
    let authorization = "";
    let url = "";
    try {
      const request = args[0];
      if (typeof request === "string") url = request;
      else if (request instanceof URL) url = request.href;
      else url = request.url;

      if (matches(url)) {
        const init = args[1];
        if (typeof init?.body === "string") {
          requestBody = truncate(init.body);
        } else if (typeof Request !== "undefined" && request instanceof Request) {
          // Cloning is the only safe way to read a Request body without consuming it.
          requestBody = truncate(await request.clone().text());
        }

        const headers =
          init?.headers ??
          (typeof Request !== "undefined" && request instanceof Request
            ? request.headers
            : undefined);
        if (headers) authorization = new Headers(headers).get("authorization") ?? "";
      }
    } catch {
      // Observation is best-effort.
    }

    const response = await originalFetch.apply(this, args);

    try {
      if (url && matches(url)) {
        // Clone before reading: the page must still get an unconsumed body.
        void response
          .clone()
          .text()
          .then((body) =>
            emit({
              provider,
              url,
              method: (args[1]?.method ?? "GET").toUpperCase(),
              status: response.status,
              requestBody,
              responseBody: truncate(body),
              authorization,
              observedAt: Date.now(),
            }),
          )
          .catch(() => {});
      }
    } catch {
      // Observation is best-effort.
    }

    return response;
  };

  // --- XMLHttpRequest ------------------------------------------------------
  const OriginalXHR = window.XMLHttpRequest;
  const openMethod = OriginalXHR.prototype.open;
  const sendMethod = OriginalXHR.prototype.send;
  const setHeaderMethod = OriginalXHR.prototype.setRequestHeader;

  interface TrackedXHR extends XMLHttpRequest {
    __lcsUrl?: string;
    __lcsMethod?: string;
    __lcsAuth?: string;
  }

  // Headers have to be caught as they're set — an XHR exposes no way to read them back.
  // Angular's HttpClient uses XHR rather than fetch, so without this the bearer token on
  // NeetCode's own calls goes past unseen and the history walk has nothing to borrow.
  //
  // Only ever recorded for a URL the filter already allows: a header from any other
  // request is not ours to hold, even in a local variable.
  OriginalXHR.prototype.setRequestHeader = function patchedSetHeader(
    this: TrackedXHR,
    name: string,
    value: string,
  ) {
    try {
      const url = this.__lcsUrl;
      if (url && matches(url) && name.toLowerCase() === "authorization") {
        this.__lcsAuth = String(value);
      }
    } catch {
      // ignore
    }
    return (setHeaderMethod as (...a: unknown[]) => void).apply(this, [name, value]);
  } as typeof setHeaderMethod;

  OriginalXHR.prototype.open = function patchedOpen(
    this: TrackedXHR,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    try {
      this.__lcsUrl = typeof url === "string" ? url : url.href;
      this.__lcsMethod = method.toUpperCase();
    } catch {
      // ignore
    }
    return (openMethod as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
  } as typeof openMethod;

  OriginalXHR.prototype.send = function patchedSend(this: TrackedXHR, ...args: unknown[]) {
    try {
      const url = this.__lcsUrl;
      if (url && matches(url)) {
        const requestBody = typeof args[0] === "string" ? truncate(args[0]) : "";
        this.addEventListener("load", () => {
          try {
            const responseBody =
              this.responseType === "" || this.responseType === "text"
                ? truncate(this.responseText)
                : "";
            emit({
              provider,
              url,
              method: this.__lcsMethod ?? "GET",
              status: this.status,
              requestBody,
              responseBody,
              authorization: this.__lcsAuth ?? "",
              observedAt: Date.now(),
            });
          } catch {
            // ignore
          }
        });
      }
    } catch {
      // ignore
    }
    return (sendMethod as (...a: unknown[]) => void).apply(this, args);
  } as typeof sendMethod;
}
