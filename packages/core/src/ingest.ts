/**
 * The one path by which adapter output becomes persisted state.
 *
 * Adapters never touch the store directly: they emit `ProgressEvent`s, the background
 * worker hands them here, and this appends to the log then folds only the delta into
 * problem state. Re-running a sync over already-seen events is a no-op.
 */

import { foldEvents } from "./events.js";
import { type ProblemState, type ProgressEvent, type ProviderId, problemKey } from "./model.js";
import type { Store } from "./store.js";

export interface IngestResult {
  received: number;
  /** Events that were new to the log; the rest were duplicates from a prior sync. */
  inserted: number;
  updatedProblems: string[];
}

export async function ingestEvents(
  store: Store,
  incoming: readonly ProgressEvent[],
): Promise<IngestResult> {
  const inserted = await store.events.append(incoming);
  if (inserted.length === 0) {
    return { received: incoming.length, inserted: 0, updatedProblems: [] };
  }

  // Grouped by provider, because state is now addressed by both. Loading a NeetCode row
  // to fold a LeetCode event would resurrect exactly the merge this split removed.
  const wanted = new Map<ProviderId, Set<string>>();
  for (const event of inserted) {
    const slugs = wanted.get(event.provider) ?? new Set<string>();
    slugs.add(event.slug);
    wanted.set(event.provider, slugs);
  }

  const initial = new Map<string, ProblemState>();
  for (const [provider, slugs] of wanted) {
    for (const state of await store.problems.getMany(provider, [...slugs])) {
      initial.set(problemKey(state.provider, state.slug), state);
    }
  }

  const folded = foldEvents(initial, inserted);
  await store.problems.put([...folded.values()]);

  return {
    received: incoming.length,
    inserted: inserted.length,
    updatedProblems: [...folded.keys()],
  };
}

/**
 * Rebuild all problem state from the full event log.
 * Use after a fold-logic change, or to repair state — the log is the source of truth.
 */
export async function rebuildFromLog(store: Store): Promise<number> {
  const events = await store.events.all();
  const folded = foldEvents(new Map(), events);
  await store.problems.put([...folded.values()]);
  return folded.size;
}
