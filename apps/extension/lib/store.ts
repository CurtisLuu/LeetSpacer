import type { Store } from "@lcs/core";
import { createDefaultStore } from "@lcs/store";

/**
 * One store connection per extension context.
 *
 * The background worker and each UI surface open their own IndexedDB handle against the
 * same database. Reads happen locally in whichever context needs them; writes that
 * matter (sync, ingest) are funnelled through the background so ordering stays sane.
 */
let pending: Promise<Store> | undefined;

export function getStore(): Promise<Store> {
  pending ??= createDefaultStore();
  return pending;
}
