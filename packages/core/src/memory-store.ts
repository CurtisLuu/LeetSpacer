/**
 * In-memory `Store`. Used by tests and as the reference implementation that
 * `@lcs/store`'s IndexedDB version is checked against.
 */

import { type ProblemState, type ProgressEvent, type ReviewCard, type ReviewLog, type Timestamp, cardKey } from "./model.js";
import { type Settings, withDefaults } from "./settings.js";
import type { Store, StoreSnapshot } from "./store.js";

export function createMemoryStore(initial?: Partial<StoreSnapshot>): Store {
  const events = new Map<string, ProgressEvent>();
  const problems = new Map<string, ProblemState>();
  const cards = new Map<string, ReviewCard>();
  const logs = new Map<string, ReviewLog>();
  let settings: Settings = withDefaults(initial?.settings);

  for (const ev of initial?.events ?? []) events.set(ev.id, ev);
  for (const p of initial?.problems ?? []) problems.set(p.slug, p);
  for (const c of initial?.cards ?? []) cards.set(cardKey(c.track, c.slug), c);
  for (const l of initial?.logs ?? []) logs.set(l.id, l);

  const meta = new Map<string, unknown>();

  const store: Store = {
    events: {
      async append(incoming) {
        const inserted: ProgressEvent[] = [];
        for (const ev of incoming) {
          if (events.has(ev.id)) continue;
          events.set(ev.id, ev);
          inserted.push(ev);
        }
        return inserted;
      },
      async since(observedAfter: Timestamp) {
        return [...events.values()].filter((e) => e.observedAt > observedAfter);
      },
      async all() {
        return [...events.values()];
      },
      async count(provider) {
        if (provider === undefined) return events.size;
        let total = 0;
        for (const ev of events.values()) if (ev.provider === provider) total += 1;
        return total;
      },
      async remove(ids) {
        let removed = 0;
        for (const id of ids) if (events.delete(id)) removed += 1;
        return removed;
      },
    },

    problems: {
      async get(slug) {
        return problems.get(slug);
      },
      async getMany(slugs) {
        const out: ProblemState[] = [];
        for (const slug of slugs) {
          const found = problems.get(slug);
          if (found) out.push(found);
        }
        return out;
      },
      async all() {
        return [...problems.values()];
      },
      async put(states) {
        for (const s of states) problems.set(s.slug, s);
      },
      async remove(slugs) {
        let removed = 0;
        for (const slug of slugs) if (problems.delete(slug)) removed += 1;
        return removed;
      },
    },

    cards: {
      async get(track, slug) {
        return cards.get(cardKey(track, slug));
      },
      async due(track, at, limit) {
        const found = [...cards.values()]
          .filter((c) => c.track === track && c.due <= at)
          .sort((a, b) => a.due - b.due);
        return limit === undefined ? found : found.slice(0, limit);
      },
      async all(track) {
        const found = [...cards.values()];
        return track === undefined ? found : found.filter((c) => c.track === track);
      },
      async put(incoming) {
        for (const c of incoming) cards.set(cardKey(c.track, c.slug), c);
      },
      async remove(track, slug) {
        cards.delete(cardKey(track, slug));
      },
    },

    logs: {
      async append(incoming) {
        for (const l of incoming) logs.set(l.id, l);
      },
      async forProblem(track, slug) {
        return [...logs.values()]
          .filter((l) => l.track === track && l.slug === slug)
          .sort((a, b) => a.reviewedAt - b.reviewedAt);
      },
      async since(reviewedAfter) {
        return [...logs.values()].filter((l) => l.reviewedAt > reviewedAfter);
      },
    },

    settings: {
      async get() {
        return settings;
      },
      async update(patch) {
        settings = withDefaults({ ...settings, ...patch });
        return settings;
      },
    },

    meta: {
      async get<T>(key: string) {
        return meta.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T) {
        meta.set(key, value);
      },
      async remove(key) {
        meta.delete(key);
      },
    },

    async exportSnapshot() {
      return {
        version: 2,
        exportedAt: Date.now(),
        events: [...events.values()],
        problems: [...problems.values()],
        cards: [...cards.values()],
        logs: [...logs.values()],
        settings,
      };
    },

    async importSnapshot(snapshot, mode) {
      if (mode === "replace") await store.clear();
      for (const ev of snapshot.events) if (!events.has(ev.id)) events.set(ev.id, ev);
      for (const p of snapshot.problems) problems.set(p.slug, p);
      for (const c of snapshot.cards) cards.set(cardKey(c.track, c.slug), c);
      for (const l of snapshot.logs) logs.set(l.id, l);
      settings = withDefaults(snapshot.settings);
    },

    async clear() {
      events.clear();
      problems.clear();
      cards.clear();
      logs.clear();
      meta.clear();
      settings = withDefaults(undefined);
    },
  };

  return store;
}
