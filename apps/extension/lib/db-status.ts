/**
 * Whether this context's database connection has been retired.
 *
 * Split out from `lib/store.ts` so the surfaces that only talk to the background — the
 * popup, for one — can subscribe without pulling the IndexedDB layer into their bundle.
 *
 * The situation it describes: another context opened the database at a newer version, so
 * every older connection was asked to close and did. Code in this context is then holding
 * a dead handle, and since the code itself is the old code, retrying cannot help. The
 * surface has to reload.
 */
let superseded = false;

const listeners = new Set<() => void>();

export function isSuperseded(): boolean {
  return superseded;
}

/** Subscribe. Fires immediately if it has already happened, and returns an unsubscribe. */
export function onSuperseded(listener: () => void): () => void {
  listeners.add(listener);
  if (superseded) listener();
  return () => listeners.delete(listener);
}

export function markSuperseded(): void {
  if (superseded) return;
  superseded = true;
  for (const listener of listeners) listener();
}
