import {
  type ProblemState,
  type ProgressEvent,
  type ReviewCard,
  type ReviewLog,
  type Settings,
  type Store,
  type StoreSnapshot,
  trackForLegacyCard,
  withDefaults,
} from "@lcs/core";
import { type IDBPDatabase, type IDBPTransaction, type StoreNames, openDB } from "idb";

import { DB_NAME, DB_VERSION, type LcsDB, META_PREFIX, SETTINGS_KEY } from "./schema.js";

export type LcsDatabase = IDBPDatabase<LcsDB>;

export function openLcsDb(name = DB_NAME): Promise<LcsDatabase> {
  return openDB<LcsDB>(name, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("observedAt", "observedAt");
      }
      if (!db.objectStoreNames.contains("problems")) {
        const problems = db.createObjectStore("problems", { keyPath: "slug" });
        problems.createIndex("status", "status");
        problems.createIndex("lastSolvedAt", "lastSolvedAt");
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }

      // Fresh database: create the per-track stores directly.
      if (oldVersion < 1) {
        createCardStore(db);
        createLogStore(db);
        return;
      }

      // Existing database from before the track split. A keyPath can't be altered in
      // place, so the rows are read out, the stores rebuilt, and the rows written back
      // with a track attached. Everyone's schedules survive; only their address changes.
      if (oldVersion < 2) await migrateToTracks(db, tx);
    },
  });
}

function createCardStore(db: IDBPDatabase<LcsDB>): void {
  const cards = db.createObjectStore("cards", { keyPath: ["track", "slug"] });
  cards.createIndex("trackDue", ["track", "due"]);
}

function createLogStore(db: IDBPDatabase<LcsDB>): void {
  const logs = db.createObjectStore("logs", { keyPath: "id" });
  logs.createIndex("trackSlug", ["track", "slug"]);
  logs.createIndex("reviewedAt", "reviewedAt");
}

/**
 * Move v1's slug-keyed cards and logs into per-track stores.
 *
 * Each row is assigned the one track its problem's sources point at — never both. A
 * duplicated card would mean the same review landing in two queues on two schedules, and
 * a duplicated *log* would be a fabricated grade, which is worse: it's a claim you
 * reviewed something you didn't. Whichever track a problem isn't placed in simply starts
 * empty there and gets seeded on the next sync.
 */
async function migrateToTracks(
  db: IDBPDatabase<LcsDB>,
  tx: IDBPTransaction<LcsDB, StoreNames<LcsDB>[], "versionchange">,
): Promise<void> {
  const problems = (await tx.objectStore("problems").getAll()) as ProblemState[];
  const sourcesBySlug = new Map(problems.map((problem) => [problem.slug, problem]));
  const trackFor = (slug: string) => trackForLegacyCard(sourcesBySlug.get(slug));

  // Read everything out before the stores are torn down.
  const legacyCards = tx.objectStoreNames.contains("cards")
    ? ((await tx.objectStore("cards").getAll()) as Omit<ReviewCard, "track">[])
    : [];
  const legacyLogs = tx.objectStoreNames.contains("logs")
    ? ((await tx.objectStore("logs").getAll()) as Omit<ReviewLog, "track">[])
    : [];

  if (db.objectStoreNames.contains("cards")) db.deleteObjectStore("cards");
  if (db.objectStoreNames.contains("logs")) db.deleteObjectStore("logs");
  createCardStore(db);
  createLogStore(db);

  const cards = tx.objectStore("cards");
  for (const card of legacyCards) {
    await cards.put({ ...card, track: trackFor(card.slug) });
  }

  const logs = tx.objectStore("logs");
  for (const log of legacyLogs) {
    const track = trackForLegacyCard(sourcesBySlug.get(log.slug));
    await logs.put({ ...log, track, id: `${track}:${log.slug}:${log.reviewedAt}` });
  }
}

/**
 * Every `[track, due]` key for one track, optionally capped at `until`.
 *
 * The open upper bound is `[track, []]`: IndexedDB sorts arrays after every number, so an
 * empty array is a clean "greater than any due date" sentinel and avoids relying on
 * `Infinity` being a valid key.
 */
function trackRange(track: string, until?: number): IDBKeyRange {
  return IDBKeyRange.bound([track], [track, until ?? []]);
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
      async get(track, slug) {
        return db.get("cards", [track, slug]);
      },
      async due(track, at, limit) {
        // The compound index orders by track first, then due, so bounding both ends keeps
        // the scan inside this track. `[track]` sorts before any `[track, n]` because a
        // shorter array precedes a longer one sharing its prefix.
        return db.getAllFromIndex("cards", "trackDue", trackRange(track, at), limit);
      },
      async all(track) {
        if (track === undefined) return db.getAll("cards");
        return db.getAllFromIndex("cards", "trackDue", trackRange(track));
      },
      async put(cards) {
        const tx = db.transaction("cards", "readwrite");
        await Promise.all(cards.map((c) => tx.store.put(c)));
        await tx.done;
      },
      async remove(track, slug) {
        await db.delete("cards", [track, slug]);
      },
    },

    logs: {
      async append(logs) {
        const tx = db.transaction("logs", "readwrite");
        await Promise.all(logs.map((l) => tx.store.put(l)));
        await tx.done;
      },
      async forProblem(track, slug) {
        const found = await db.getAllFromIndex("logs", "trackSlug", [track, slug]);
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
      return { version: 2, exportedAt: Date.now(), events, problems, cards, logs, settings };
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
