import type { Store } from "@lcs/core";
import { createDefaultStore } from "@lcs/store";

import { isSuperseded, markSuperseded } from "./db-status.js";

/**
 * One store connection per extension context.
 *
 * The background worker and each UI surface open their own IndexedDB handle against the
 * same database. Reads happen locally in whichever context needs them; writes that
 * matter (sync, ingest) are funnelled through the background so ordering stays sane.
 */
let pending: Promise<Store> | undefined;

export function getStore(): Promise<Store> {
  // Deliberately not reopened. A fresh connection from here would be at *this* build's
  // schema version, which is the older one — it would block the newer context that just
  // upgraded, which is the deadlock the handlers exist to avoid. The surface reloads
  // instead; `ErrorBoundary` is what asks.
  if (isSuperseded()) {
    return Promise.reject(
      new Error("This page is running an older version of LeetSpacer. Reload it."),
    );
  }

  pending ??= createDefaultStore(undefined, {
    // Reported through `db-status` rather than handled here: what to do about it is a
    // question for the surface, and the answer is a reload prompt.
    onSuperseded: markSuperseded,
    onBlocked: () =>
      console.warn("[lcs] waiting for another LeetSpacer surface to release the database"),
  });

  // A rejected open must not be cached. Opening can fail transiently — the profile busy,
  // a storage permission prompt — and caching that rejection would leave this context
  // permanently broken while a simple retry would have worked.
  return pending.catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}
