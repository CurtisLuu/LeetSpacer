import type { NeetcodeTransport } from "@lcs/providers";

/**
 * Same-origin access to neetcode.io's callable endpoint.
 *
 * NeetCode's endpoints are Firebase callables, which take a bearer token rather than a
 * cookie. The token is *not* read out of Firebase's storage: the copy kept there expires
 * hourly and is routinely stale, which produced a 401 on every sync. Instead the
 * MAIN-world observer relays the `Authorization` header off the page's own calls — the
 * page makes one on load — so the token used here is by definition one that just worked.
 *
 * That also means the extension never opens Firebase's database, never triggers a token
 * refresh, and holds nothing the page wasn't already sending. The value lives in memory
 * for the life of the tab, is used only for requests back to neetcode.io, and is never
 * stored, exported or transmitted anywhere else.
 */
const ENDPOINT = "/api/callableFunctionHttp";

/** Supplies the most recently observed bearer token, or null if none has been seen. */
export type TokenSource = () => string | null;

export function createNeetcodeTransport(getToken: TokenSource): NeetcodeTransport {
  return {
    async callable(functionId, extra = {}) {
      const authorization = getToken();
      if (!authorization) throw new Error("No NeetCode session observed yet.");

      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify({ data: { functionId, ...extra } }),
      });

      if (response.status === 401 || response.status === 403) {
        // The token aged out mid-walk. Worth naming, because the alternative reading is
        // "NeetCode broke", and the fix is simply to reload the page.
        throw new Error(
          `NeetCode ${functionId} was rejected (HTTP ${response.status}) — the session token expired. Reload neetcode.io.`,
        );
      }
      if (!response.ok) {
        throw new Error(`NeetCode ${functionId} returned HTTP ${response.status}`);
      }

      // Firebase callables answer as `{result}`; this endpoint has been observed using
      // `{data}`. Accept either rather than guessing which build is deployed.
      const body = (await response.json()) as { result?: unknown; data?: unknown };
      return body.result ?? body.data ?? body;
    },
  };
}
