import type { NeetcodeTransport } from "@lcs/providers";

/**
 * Same-origin access to neetcode.io's callable endpoint, for use from a content script on
 * that origin.
 *
 * Unlike LeetCode, whose session rides along in an HttpOnly cookie the extension can't
 * read, NeetCode authenticates with a Firebase ID token held in the page's own IndexedDB.
 * There is no way to call these endpoints without it, so this reads it — and that is a
 * real step beyond the rest of the extension, which handles no credential at all.
 *
 * What that means in practice: the token is read on demand, used only for requests back to
 * the origin it came from, never written anywhere, never included in an export, and never
 * sent off the machine. It is exactly the token the page attaches to the same calls when
 * you open NeetCode's own activity page.
 */
const ENDPOINT = "/api/callableFunctionHttp";
const TOKEN_DB = "firebaseLocalStorageDb";
const TOKEN_STORE = "firebaseLocalStorage";

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The signed-in user's ID token, or null when nobody is signed in. */
async function readIdToken(): Promise<string | null> {
  try {
    const db = await idbRequest(indexedDB.open(TOKEN_DB) as unknown as IDBRequest<IDBDatabase>);
    if (!db.objectStoreNames.contains(TOKEN_STORE)) return null;

    const rows = (await idbRequest(
      db.transaction(TOKEN_STORE).objectStore(TOKEN_STORE).getAll(),
    )) as { value?: { stsTokenManager?: { accessToken?: string } } }[];

    for (const row of rows) {
      const token = row?.value?.stsTokenManager?.accessToken;
      if (token) return token;
    }
  } catch {
    // Firebase changed where it keeps this, or the database isn't there. The completed-set
    // path still works without it, so this is a downgrade rather than a failure.
  }
  return null;
}

export function createNeetcodeTransport(): NeetcodeTransport {
  return {
    async callable(functionId, extra = {}) {
      const token = await readIdToken();
      if (!token) throw new Error("No NeetCode session token — is the page signed in?");

      const response = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data: { functionId, ...extra } }),
      });

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
