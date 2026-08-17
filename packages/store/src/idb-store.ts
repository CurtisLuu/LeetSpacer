import {
  type ProblemState,
  type ProgressEvent,
  type ReviewCard,
  type ReviewLog,
  type Settings,
  type Store,
  type StoreSnapshot,
  withDefaults,
} from "@lcs/core";
import { type IDBPDatabase, openDB } from "idb";

import { DB_NAME, DB_VERSION, type LcsDB, META_PREFIX, SETTINGS_KEY } from "./schema.js";

export type LcsDatabase = IDBPDatabase<LcsDB>;

export function openLcsDb(name = DB_NAME): Promise<LcsDatabase> {
  return openDB<LcsDB>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("observedAt", "observedAt");
      }
      if (!db.objectStoreNames.contains("problems")) {
        const problems = db.createObjectStore("problems", { keyPath: "slug" });
        problems.createIndex("status", "status");
        problems.createIndex("lastSolvedAt", "lastSolvedAt");
      }
      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "slug" });
        cards.createIndex("due", "due");
      }
      if (!db.objectStoreNames.contains("logs")) {
        const logs = db.createObjectStore("logs", { keyPath: "id" });
        logs.createIndex("slug", "slug");
        logs.createIndex("reviewedAt", "reviewedAt");
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
    },
  });
}

export function createIdbStore(db: LcsDatabase): Store {
  const store: Store = {
    events: {
      async append(incoming) {
        if (incoming.length === 0) return [];
        const tx = db.transaction("events", "readwrite");
        const inserted: ProgressEvent[] = [];
        for (const ev of incoming) {
          // Deterministic ids make this the dedupe point for the whole system:
          // downstream folding can then assume every event is applied exactly once.
          if ((await tx.store.getKey(ev.id)) !== undefined) continue;
          await tx.store.put(ev);
          inserted.push(ev);
        }
        await tx.done;
        return inserted;
      },
      async since(observedAfter) {
        return db.getAllFromIndex("events", "observedAt", IDBKeyRange.lowerBound(observedAfter, true));
      },
      async all() {
        return db.getAll("events");
      },
      async count() {
        return db.count("events");
      },
      async remove(ids) {
        if (ids.length === 0) return 0;
        const tx = db.transaction("events", "readwrite");
        let removed = 0;
        for (const id of ids) {
          if ((await tx.store.getKey(id)) === undefined) continue;
          await tx.store.delete(id);
          removed += 1;
        }
        await tx.done;
        return removed;
      },
    },

    problems: {
      async get(slug) {
        return db.get("problems", slug);
      },
      async getMany(slugs) {
        const tx = db.transaction("problems", "readonly");
        const found = await Promise.all(slugs.map((slug) => tx.store.get(slug)));
        await tx.done;
        return found.filter((s): s is ProblemState => s !== undefined);
      },
      async all() {
        return db.getAll("problems");
      },
      async put(states) {
        const tx = db.transaction("problems", "readwrite");
        await Promise.all(states.map((s) => tx.store.put(s)));
        await tx.done;
      },
      async remove(slugs) {
        if (slugs.length === 0) return 0;
        const tx = db.transaction("problems", "readwrite");
        let removed = 0;
        for (const slug of slugs) {
          if ((await tx.store.getKey(slug)) === undefined) continue;
          await tx.store.delete(slug);
          removed += 1;
        }
        await tx.done;
        return removed;
      },
    },

    cards: {
      async get(slug) {
        return db.get("cards", slug);
      },
      async due(at, limit) {
        const found = await db.getAllFromIndex("cards", "due", IDBKeyRange.upperBound(at), limit);
        return found;
      },
      async all() {
        return db.getAll("cards");
      },
      async put(cards) {
        const tx = db.transaction("cards", "readwrite");
        await Promise.all(cards.map((c) => tx.store.put(c)));
        await tx.done;
      },
      async remove(slug) {
        await db.delete("cards", slug);
      },
    },

    logs: {
      async append(logs) {
        const tx = db.transaction("logs", "readwrite");
        await Promise.all(logs.map((l) => tx.store.put(l)));
        await tx.done;
      },
      async forProblem(slug) {
        const found = await db.getAllFromIndex("logs", "slug", slug);
        return found.sort((a, b) => a.reviewedAt - b.reviewedAt);
      },
      async since(reviewedAfter) {
        return db.getAllFromIndex("logs", "reviewedAt", IDBKeyRange.lowerBound(reviewedAfter, true));
      },
    },

    settings: {
      async get() {
        return withDefaults((await db.get("kv", SETTINGS_KEY)) as Partial<Settings> | undefined);
      },
      async update(patch) {
        const current = withDefaults((await db.get("kv", SETTINGS_KEY)) as Partial<Settings> | undefined);
        const next = withDefaults({ ...current, ...patch });
        await db.put("kv", next, SETTINGS_KEY);
        return next;
      },
    },

    meta: {
      async get<T>(key: string) {
        return (await db.get("kv", META_PREFIX + key)) as T | undefined;
      },
      async set<T>(key: string, value: T) {
        await db.put("kv", value, META_PREFIX + key);
      },
      async remove(key) {
        await db.delete("kv", META_PREFIX + key);
      },
    },

    async exportSnapshot() {
      const [events, problems, cards, logs, settings] = await Promise.all([
        db.getAll("events"),
        db.getAll("problems"),
        db.getAll("cards"),
        db.getAll("logs"),
        store.settings.get(),
      ]);
      return { version: 1, exportedAt: Date.now(), events, problems, cards, logs, settings };
    },

    async importSnapshot(snapshot: StoreSnapshot, mode) {
      if (mode === "replace") await store.clear();
      await store.events.append(snapshot.events);
      await store.problems.put(snapshot.problems);
      await store.cards.put(snapshot.cards);
      await store.logs.append(snapshot.logs);
      await store.settings.update(snapshot.settings);
    },

    async clear() {
      const tx = db.transaction(["events", "problems", "cards", "logs", "kv"], "readwrite");
      await Promise.all([
        tx.objectStore("events").clear(),
        tx.objectStore("problems").clear(),
        tx.objectStore("cards").clear(),
        tx.objectStore("logs").clear(),
        tx.objectStore("kv").clear(),
      ]);
      await tx.done;
    },
  };

  return store;
}

/** Convenience for the extension: open the database and wrap it in one call. */
export async function createDefaultStore(name = DB_NAME): Promise<Store> {
  return createIdbStore(await openLcsDb(name));
}

export type { ProblemState, ProgressEvent, ReviewCard, ReviewLog };
