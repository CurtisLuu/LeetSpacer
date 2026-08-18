/**
 * In-memory `Store`. Used by tests and as the reference implementation that
 * `@lcs/store`'s IndexedDB version is checked against.
 */

import { type ProblemState, type ProgressEvent, type ReviewCard, type ReviewLog, type Timestamp, cardKey, problemKey } from "./model.js";
import { type Settings, settingsWithoutConsent, withDefaults } from "./settings.js";
import type { Store, StoreSnapshot } from "./store.js";
import {
  validateAll,
  validateCard,
  validateEvent,
  validateLog,
  validateProblemState,
} from "./validate.js";

export function createMemoryStore(initial?: Partial<StoreSnapshot>): Store {
  const events = new Map<string, ProgressEvent>();
  const problems = new Map<string, ProblemState>();
  const cards = new Map<string, ReviewCard>();
  const logs = new Map<string, ReviewLog>();
  let settings: Settings = withDefaults(initial?.settings);

  for (const ev of initial?.events ?? []) events.set(ev.id, ev);
  for (const p of initial?.problems ?? []) problems.set(problemKey(p.provider, p.slug), p);
  for (const c of initial?.cards ?? []) cards.set(cardKey(c.track, c.slug), c);
  for (const l of initial?.logs ?? []) logs.set(l.id, l);

  const meta = new Map<string, unknown>();

  const store: Store = {
    events: {
      async append(incoming) {
        const inserted: ProgressEvent[] = [];
        for (const ev of incoming) {
          validateEvent(ev);
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
      async get(provider, slug) {
        return problems.get(problemKey(provider, slug));
      },
      async getMany(provider, slugs) {
        const out: ProblemState[] = [];
        for (const slug of slugs) {
          const found = problems.get(problemKey(provider, slug));
          if (found) out.push(found);
        }
        return out;
      },
      async all(provider) {
        const found = [...problems.values()];
        return provider === undefined ? found : found.filter((p) => p.provider === provider);
      },
      async countSolved(provider) {
        let total = 0;
        for (const state of problems.values()) {
          if (state.provider === provider && state.status === "solved") total += 1;
        }
        return total;
      },
      async put(states) {
        for (const s of states) {
          validateProblemState(s);
          problems.set(problemKey(s.provider, s.slug), s);
        }
      },
      async remove(provider, slugs) {
        let removed = 0;
        for (const slug of slugs) if (problems.delete(problemKey(provider, slug))) removed += 1;
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
      async count(track) {
        let total = 0;
        for (const card of cards.values()) if (card.track === track) total += 1;
        return total;
      },
      async countDue(track, at) {
        let total = 0;
        for (const card of cards.values()) {
          if (card.track === track && card.due <= at) total += 1;
        }
        return total;
      },
      async nextAfter(track, at) {
        let soonest: ReviewCard | undefined;
        for (const card of cards.values()) {
          if (card.track !== track || card.due <= at) continue;
          if (soonest === undefined || card.due < soonest.due) soonest = card;
        }
        return soonest;
      },
      async put(incoming) {
        // Validated here too, not only in the IndexedDB store: this one is the reference
        // implementation the other is tested against, and a divergence in what each will
        // accept is exactly the kind of difference those tests exist to catch.
        for (const c of incoming) {
          validateCard(c);
          cards.set(cardKey(c.track, c.slug), c);
        }
      },
      async remove(track, slug) {
        cards.delete(cardKey(track, slug));
      },
    },

    logs: {
      async append(incoming) {
        for (const l of incoming) {
          validateLog(l);
          logs.set(l.id, l);
        }
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
      async patchProvider(provider, patch) {
        settings = withDefaults({
          ...settings,
          providers: { ...settings.providers, [provider]: { ...settings.providers[provider], ...patch } },
        });
        return settings;
      },
      async patchTrack(track, patch) {
        settings = withDefaults({
          ...settings,
          tracks: { ...settings.tracks, [track]: { ...settings.tracks[track], ...patch } },
        });
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
        version: 3,
        exportedAt: Date.now(),
        events: [...events.values()],
        problems: [...problems.values()],
        cards: [...cards.values()],
        logs: [...logs.values()],
        settings,
      };
    },

    async importSnapshot(snapshot, mode) {
      // Everything is checked before anything is written. A half-applied import is worse
      // than a rejected one, and the IndexedDB store gets the same property from a single
      // transaction — this is the in-memory equivalent.
      validateAll(snapshot.events, validateEvent);
      validateAll(snapshot.problems, validateProblemState);
      validateAll(snapshot.cards, validateCard);
      validateAll(snapshot.logs, validateLog);

      if (mode === "replace") await store.clear();
      for (const ev of snapshot.events) if (!events.has(ev.id)) events.set(ev.id, ev);
      for (const p of snapshot.problems) problems.set(problemKey(p.provider, p.slug), p);
      for (const c of snapshot.cards) cards.set(cardKey(c.track, c.slug), c);
      for (const l of snapshot.logs) logs.set(l.id, l);
      // Merged over what is already here, not replacing it, so the acceptance record
      // survives the import — see `settingsWithoutConsent`.
      settings = withDefaults({ ...settings, ...settingsWithoutConsent(snapshot.settings) });
    },

    async clearTrack(track) {
      const cleared = { events: 0, problems: 0, cards: 0, logs: 0 };

      for (const [id, event] of events) {
        if (event.provider === track && events.delete(id)) cleared.events += 1;
      }
      for (const [key, problem] of problems) {
        if (problem.provider === track && problems.delete(key)) cleared.problems += 1;
      }
      for (const [key, card] of cards) {
        if (card.track === track && cards.delete(key)) cleared.cards += 1;
      }
      for (const [id, log] of logs) {
        if (log.track === track && logs.delete(id)) cleared.logs += 1;
      }

      // Rewound so the site imports from scratch rather than asking for "anything since
      // the sync that produced the history we just deleted". The username goes with it:
      // it was read from that site's session, not chosen here.
      settings = withDefaults({
        ...settings,
        providers: {
          ...settings.providers,
          [track]: {
            ...settings.providers[track],
            username: null,
            lastFullSyncAt: null,
            lastIncrementalSyncAt: null,
          },
        },
      });

      return cleared;
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
