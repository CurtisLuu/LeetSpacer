import type { GraphqlOperation, LeetcodeTransport } from "@lcs/providers";

/**
 * Same-origin access to leetcode.com, for use from a content script on that origin.
 *
 * The whole security story of this adapter lives in these few lines. Requests are
 * relative, so they're same-origin; `credentials: "include"` sends the session cookie the
 * browser already holds; nothing is read out of storage and nothing is stored. The
 * extension never sees the session token — it can't, since `LEETCODE_SESSION` is
 * HttpOnly. `csrftoken` deliberately isn't, because LeetCode's own front end has to echo
 * it back on mutating and user-scoped queries, which is exactly what we do here.
 */
const GRAPHQL_PATH = "/graphql/";

function csrfToken(): string | null {
  const match = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
  return match?.[1] ?? null;
}

async function readJson(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`LeetCode ${what} returned HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function createLeetcodeTransport(): LeetcodeTransport {
  return {
    async graphql(operation: GraphqlOperation, variables?: unknown) {
      const token = csrfToken();
      const response = await fetch(GRAPHQL_PATH, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          // User-scoped queries are rejected without it; omitted rather than faked when
          // the cookie isn't there, so the failure is LeetCode's clear 403 and not ours.
          ...(token ? { "x-csrftoken": token } : {}),
        },
        body: JSON.stringify({
          operationName: operation.operationName,
          query: operation.query,
          variables: variables ?? {},
        }),
      });

      const body = (await readJson(response, operation.operationName)) as {
        errors?: { message: string }[];
      };
      if (body.errors?.length) {
        throw new Error(
          `LeetCode ${operation.operationName}: ${body.errors.map((e) => e.message).join("; ")}`,
        );
      }
      return body;
    },

    async rest(path: string) {
      const response = await fetch(path, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      return readJson(response, path);
    },
  };
}
