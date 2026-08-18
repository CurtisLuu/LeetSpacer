import {
  type ClearedCounts,
  type ProblemState,
  type ProgressEvent,
  type ReviewCard,
  type ReviewLog,
  type Settings,
  type Store,
  type StoreSnapshot,
  type TrackId,
  rebuildFromLog,
  settingsWithoutConsent,
  trackForLegacyCard,
  validateCard,
  validateEvent,
  validateLog,
  validateProblemState,
  withDefaults,
} from "@lcs/core";
import { type IDBPDatabase, type IDBPTransaction, type StoreNames, openDB } from "idb";

import { DB_NAME, DB_VERSION, type LcsDB, META_PREFIX, SETTINGS_KEY } from "./schema.js";

export type LcsDatabase = IDBPDatabase<LcsDB>;

/**
 * What to do when another context needs the database at a newer version.
 *
 * `blocking` fires on *this* connection when another one is waiting to upgrade; holding
 * on stalls it for ever, so the only correct move is to close and let it through.
 * `blocked` is the other side of the same moment: this connection is the one waiting.
 */
export interface ConnectionEvents {
  /** This connection was closed to let an upgrade through. The context should reload. */
  onSuperseded?: () => void;
  /** An upgrade here is waiting on an older connection somewhere else. */
  onBlocked?: () => void;
}

export function openLcsDb(name = DB_NAME, events: ConnectionEvents = {}): Promise<LcsDatabase> {
  return openDB<LcsDB>(name, DB_VERSION, {
    /**
     * Another context is upgrading and needs this connection gone.
     *
     * Without this handler `versionchange` fires with nobody listening, the upgrade never
     * starts, and its `openDB` promise never settles — so in that context `getStore()`
     * never resolves and every message handler hangs, silently and for ever. Four
     * contexts each open their own connection, so a version bump reaches this
     * every time.
     */
    blocking(_currentVersion, _blockedVersion, event) {
      console.info("[lcs] closing this database connection so an upgrade can run");
      (event.target as IDBDatabase | null)?.close();
      events.onSuperseded?.();
    },
    blocked() {
      // The reverse: we are the upgrade, and something older is still holding on. It gets
      // the `blocking` call above and closes; this is only worth saying out loud.
      console.warn("[lcs] database upgrade waiting on another tab or panel to close");
      events.onBlocked?.();
    },
    terminated() {
      // The browser dropped the connection out from under us — a crashed backing store,
      // or storage cleared while running. Anything holding this handle is now dead.
      console.warn("[lcs] database connection terminated by the browser");
      events.onSuperseded?.();
    },
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains("events")) {
        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("observedAt", "observedAt");
        events.createIndex("provider", "provider");
      }
      if (!db.objectStoreNames.contains("problems")) createProblemStore(db);
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

      // v3: the events store gained a provider index. Nothing moves — IndexedDB builds it
      // over the existing rows inside this same transaction.
      const events = tx.objectStore("events");
      if (!events.indexNames.contains("provider")) {
        events.createIndex("provider", "provider");
      }

      // v4: problem state split per provider. The merged rows carried a solve date from
      // one site and an attempt count from the other, so there is nothing to attribute
      // and no way to split them — they're dropped and refolded from the log instead,
      // which loses nothing because the log is the source of truth. `rebuildFromLog`
      // runs on next open; see `createDefaultStore`.
      if (oldVersion < 4 && db.objectStoreNames.contains("problems")) {
        db.deleteObjectStore("problems");
        createProblemStore(db);
      }

      // v5: an index for the solved counts, and a repair for cards the old code could
      // write but nothing could read.
      const problems = tx.objectStore("problems");
      if (!problems.indexNames.contains("providerStatus")) {
        problems.createIndex("providerStatus", ["provider", "status"]);
      }
      if (oldVersion < 5) await repairUnschedulableCards(tx);
    },
  });
}

/**
 * Give a due date back to any card that lost one.
 *
 * A card whose `due` is `NaN`, `Infinity` or missing has no valid key in the
 * `[track, due]` index, so IndexedDB leaves it out of every read that goes through it:
 * the queue, the badge, the browse list. `cards.put` now refuses to write one, but a
 * database that already contains one would keep it invisible for ever — and seeding,
 * which builds its "already exists" set from the same index, would re-create it on every
 * sync. Rescheduling it to now surfaces it, keeping its review history intact.
 */
async function repairUnschedulableCards(
  tx: IDBPTransaction<LcsDB, StoreNames<LcsDB>[], "versionchange">,
): Promise<void> {
  if (!tx.objectStoreNames.contains("cards")) return;

  const cards = tx.objectStore("cards");
  const now = Date.now();
  let repaired = 0;

  // A plain `getAll` deliberately: the broken rows are precisely the ones the index
  // cannot see, so anything that reads through it would miss them.
  for (const card of (await cards.getAll()) as ReviewCard[]) {
    if (Number.isFinite(card.due)) continue;
    await cards.put({ ...card, due: now });
    repaired += 1;
  }

  if (repaired > 0) {
    console.info(`[lcs] gave ${repaired} unschedulable card${repaired === 1 ? "" : "s"} a due date`);
  }
}

function createProblemStore(db: IDBPDatabase<LcsDB>): void {
  const problems = db.createObjectStore("problems", { keyPath: ["provider", "slug"] });
  problems.createIndex("provider", "provider");
  // Both indexes belong to a freshly created store. A new install takes the early return
  // below and never reaches the version blocks, so an index only added there would exist
  // on every upgraded database and on none of the new ones.
  problems.createIndex("providerStatus", ["provider", "status"]);
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

/**
 * Read, change and write settings inside one transaction.
 *
 * IndexedDB serializes readwrite transactions on a store across every connection, so the
 * read and the write cannot be interleaved with another context's. That is what makes the
 * merge in `apply` see whatever was actually stored a moment ago rather than a copy the
 * caller read minutes earlier.
 */
async function writeSettings(
  db: LcsDatabase,
  apply: (current: Settings) => Settings,
): Promise<Settings> {
  const tx = db.transaction("kv", "readwrite");
  const current = withDefaults((await tx.store.get(SETTINGS_KEY)) as Partial<Settings> | undefined);
  const next = withDefaults(apply(current));
  await tx.store.put(next, SETTINGS_KEY);
  await tx.done;
  return next;
}

export function createIdbStore(db: LcsDatabase): Store {
  const store: Store = {
    events: {
      async append(incoming) {
        if (incoming.length === 0) return [];
        for (const event of incoming) validateEvent(event);
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
      async count(provider) {
        if (provider === undefined) return db.count("events");
        return db.countFromIndex("events", "provider", provider);
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
      async get(provider, slug) {
        return db.get("problems", [provider, slug]);
      },
      async getMany(provider, slugs) {
        const tx = db.transaction("problems", "readonly");
        const found = await Promise.all(slugs.map((slug) => tx.store.get([provider, slug])));
        await tx.done;
        return found.filter((s): s is ProblemState => s !== undefined);
      },
      async all(provider) {
        if (provider === undefined) return db.getAll("problems");
        return db.getAllFromIndex("problems", "provider", provider);
      },
      async countSolved(provider) {
        return db.countFromIndex("problems", "providerStatus", [provider, "solved"]);
      },
      async put(states) {
        // Checked before the transaction opens, so a bad row rejects the call instead of
        // half-applying it.
        for (const state of states) validateProblemState(state);
        const tx = db.transaction("problems", "readwrite");
        await Promise.all(states.map((s) => tx.store.put(s)));
        await tx.done;
      },
      async remove(provider, slugs) {
        if (slugs.length === 0) return 0;
        const tx = db.transaction("problems", "readwrite");
        let removed = 0;
        for (const slug of slugs) {
          if ((await tx.store.getKey([provider, slug])) === undefined) continue;
          await tx.store.delete([provider, slug]);
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
      async count(track) {
        return db.countFromIndex("cards", "trackDue", trackRange(track));
      },
      async countDue(track, at) {
        return db.countFromIndex("cards", "trackDue", trackRange(track, at));
      },
      async nextAfter(track, at) {
        // Everything in this track after `at`, taking one. The lower bound is exclusive,
        // so a card due at exactly `at` is due now rather than next.
        const [soonest] = await db.getAllFromIndex(
          "cards",
          "trackDue",
          IDBKeyRange.bound([track, at], [track, []], true, false),
          1,
        );
        return soonest;
      },
      async put(cards) {
        // The write that has to be strict. A card whose `due` is not a finite number has
        // no key in the `[track, due]` index, so IndexedDB accepts it and then hides it
        // from every read the queue makes — see `validateCard`.
        for (const card of cards) validateCard(card);
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
        for (const log of logs) validateLog(log);
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
        // Read and write inside one transaction. Four contexts hold their own connection
        // to this database — the background worker, the side panel, the popup, the
        // options page — and a read-then-write across two transactions lets the options
        // page's save land on top of a provider update the background made in between,
        // silently undoing it. IndexedDB serializes readwrite transactions on a store, so
        // doing both here is what makes the update atomic rather than merely quick.
        return writeSettings(db, (current) => ({ ...current, ...patch }));
      },
      async patchProvider(provider, patch) {
        // Read inside the transaction and merged into one provider, so a write from
        // another context in between is merged with rather than overwritten — and so a
        // caller working from a stale copy of settings can only ever be stale about the
        // one source it named.
        return writeSettings(db, (current) => ({
          ...current,
          providers: {
            ...current.providers,
            [provider]: { ...current.providers[provider], ...patch },
          },
        }));
      },
      async patchTrack(track, patch) {
        return writeSettings(db, (current) => ({
          ...current,
          tracks: { ...current.tracks, [track]: { ...current.tracks[track], ...patch } },
        }));
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
      return { version: 3, exportedAt: Date.now(), events, problems, cards, logs, settings };
    },

    /**
     * Apply a whole snapshot, or none of it.
     *
     * One transaction across every store, for the reason the file header gives: a
     * half-applied import is far worse than a rejected one. The previous version ran five
     * separate transactions in sequence, so a card that failed to write left the events
     * and problems from the same file already committed — an account in a state that
     * neither the file nor the machine had ever been in.
     *
     * Validating first is part of the same promise. `parseSnapshot` has usually done it
     * already, but this is the seam a future sync implementation would come through too.
     */
    async importSnapshot(snapshot: StoreSnapshot, mode) {
      for (const event of snapshot.events) validateEvent(event);
      for (const state of snapshot.problems) validateProblemState(state);
      for (const card of snapshot.cards) validateCard(card);
      for (const log of snapshot.logs) validateLog(log);

      const tx = db.transaction(["events", "problems", "cards", "logs", "kv"], "readwrite");
      const events = tx.objectStore("events");
      const problems = tx.objectStore("problems");
      const cards = tx.objectStore("cards");
      const logs = tx.objectStore("logs");
      const kv = tx.objectStore("kv");

      if (mode === "replace") {
        await Promise.all([events.clear(), problems.clear(), cards.clear(), logs.clear()]);
      }

      // Events dedupe by id: an existing one is a fact we already recorded, and the
      // stored copy is the one everything downstream was folded from.
      for (const event of snapshot.events) {
        if ((await events.getKey(event.id)) === undefined) await events.put(event);
      }
      await Promise.all([
        ...snapshot.problems.map((state) => problems.put(state)),
        ...snapshot.cards.map((card) => cards.put(card)),
        ...snapshot.logs.map((log) => logs.put(log)),
      ]);

      // Settings ride along in the same transaction, minus the acceptance record, which
      // stays whatever this install already decided — see `settingsWithoutConsent`.
      const current = withDefaults((await kv.get(SETTINGS_KEY)) as Partial<Settings> | undefined);
      await kv.put(
        withDefaults({ ...current, ...settingsWithoutConsent(snapshot.settings) }),
        SETTINGS_KEY,
      );

      await tx.done;
    },

    /**
     * Erase one site, in a single transaction.
     *
     * All of it or none of it, for the same reason an import is: a "start over" that
     * deleted the cards but left the events behind would look finished and then rebuild
     * half the track on the next sync. Every read here is through an index scoped to the
     * one track, so the other one is never so much as opened.
     */
    async clearTrack(track: TrackId): Promise<ClearedCounts> {
      const tx = db.transaction(["events", "problems", "cards", "logs", "kv"], "readwrite");
      const cleared = { events: 0, problems: 0, cards: 0, logs: 0 };

      for (
        let cursor = await tx.objectStore("events").index("provider").openCursor(track);
        cursor;
        cursor = await cursor.continue()
      ) {
        await cursor.delete();
        cleared.events += 1;
      }

      for (
        let cursor = await tx.objectStore("problems").index("provider").openCursor(track);
        cursor;
        cursor = await cursor.continue()
      ) {
        await cursor.delete();
        cleared.problems += 1;
      }

      for (
        let cursor = await tx
          .objectStore("cards")
          .index("trackDue")
          .openCursor(trackRange(track));
        cursor;
        cursor = await cursor.continue()
      ) {
        await cursor.delete();
        cleared.cards += 1;
      }

      // Logs have no index on `track` alone, but `[track, slug]` bounds the same way the
      // card index does: `[track]` sorts before every `[track, …]`.
      for (
        let cursor = await tx
          .objectStore("logs")
          .index("trackSlug")
          .openCursor(IDBKeyRange.bound([track], [track, []]));
        cursor;
        cursor = await cursor.continue()
      ) {
        await cursor.delete();
        cleared.logs += 1;
      }

      // The cursors are rewound in the same transaction, so the deletion and the
      // instruction to re-import can't come apart. Without it the next sync would ask for
      // "anything since the walk that produced the history just deleted" and import
      // nothing, leaving the track permanently empty.
      const kv = tx.objectStore("kv");
      const settings = withDefaults((await kv.get(SETTINGS_KEY)) as Partial<Settings> | undefined);
      await kv.put(
        withDefaults({
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
        }),
        SETTINGS_KEY,
      );

      await tx.done;
      return cleared;
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

/**
 * Convenience for the extension: open the database and wrap it in one call.
 *
 * Refolds problem state from the log when the store is empty but events exist. That is
 * exactly the situation the v4 upgrade leaves behind, and it's also a general repair —
 * the log is the source of truth, so rebuilding from it can only ever be correct.
 */
export async function createDefaultStore(
  name: string = DB_NAME,
  events: ConnectionEvents = {},
): Promise<Store> {
  const store = createIdbStore(await openLcsDb(name, events));

  const [problems, eventCount] = await Promise.all([store.problems.all(), store.events.count()]);
  if (problems.length === 0 && eventCount > 0) {
    const rebuilt = await rebuildFromLog(store);
    console.info(`[lcs] rebuilt ${rebuilt} problem states from ${eventCount} events`);
  }

  return store;
}

export type { ProblemState, ProgressEvent, ReviewCard, ReviewLog };
