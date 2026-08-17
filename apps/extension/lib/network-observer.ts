import type { ProviderId } from "@lcs/core";

import { BRIDGE_MESSAGE, MAX_BODY_CHARS, type PageObservation } from "./page-bridge.js";

/**
 * Watches the requests the page itself makes, from the MAIN world.
 *
 * This is how we learn about an accepted submission the moment it happens, and how
 * capture mode records the real shape of LeetCode's API — without polling and without
 * issuing a single request of our own. It is strictly passive: every wrapper returns the
 * original value untouched, and any failure inside our observation code is swallowed so
 * it can never break the host page.
 */
export function installNetworkObserver(provider: ProviderId, urlFilter: RegExp): void {
  const publish = (observation: Omit<PageObservation, "type">) => {
    try {
      // Same-origin only. Broadcasting with "*" would have put a bearer token on a bus
      // any embedded frame could read.
      window.postMessage(
        { type: BRIDGE_MESSAGE, ...observation } satisfies PageObservation,
        location.origin,
      );
    } catch {
      // Never let observation break the page.
    }
  };

  const truncate = (body: string) => body.slice(0, MAX_BODY_CHARS);

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

      if (urlFilter.test(url)) {
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
      if (url && urlFilter.test(url)) {
        // Clone before reading: the page must still get an unconsumed body.
        void response
          .clone()
          .text()
          .then((body) =>
            publish({
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

  interface TrackedXHR extends XMLHttpRequest {
    __lcsUrl?: string;
    __lcsMethod?: string;
  }

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
      if (url && urlFilter.test(url)) {
        const requestBody = typeof args[0] === "string" ? truncate(args[0]) : "";
        this.addEventListener("load", () => {
          try {
            const responseBody =
              this.responseType === "" || this.responseType === "text"
                ? truncate(this.responseText)
                : "";
            publish({
              provider,
              url,
              method: this.__lcsMethod ?? "GET",
              status: this.status,
              requestBody,
              responseBody,
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
