import "fake-indexeddb/auto";

import type { ProviderId } from "@lcs/core";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";

import { createDefaultStore, createIdbStore, openLcsDb } from "./idb-store.js";

/**
 * Upgrading a real user's database from before the track split.
 *
 * This is the one piece of code in the repo that can destroy data it didn't create, so it
 * gets tested against an actual version 1 database rather than a hand-made fixture:
 * the schema below is a verbatim copy of what v1 shipped.
 */

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

let dbCounter = 0;

/** Shaped as version 1 stored it: one row per slug, listing its sources. */
function problem(slug: string, sources: ProviderId[]) {
  return {
    slug,
    status: "solved",
    firstSolvedAt: T0,
    lastSolvedAt: T0,
    attempts: 2,
    acceptedCount: 1,
    sources,
    hasDatedSolve: false,
    listChecked: {},
    updatedAt: T0,
  };
}

/** A card exactly as version 1 stored it: keyed by slug, with no track. */
function legacyCard(slug: string, due: number) {
  return {
    slug,
    due,
    stability: 4.2,
    difficulty: 6.1,
    elapsedDays: 3,
    scheduledDays: 7,
    learningSteps: 0,
    reps: 5,
    lapses: 1,
    phase: "review",
    lastReview: T0,
  };
}

/** Build a version 1 database, populate it, and close it — as if the user had one. */
async function seedLegacyDb(name: string) {
  const db = await openDB(name, 1, {
    upgrade(database) {
      const events = database.createObjectStore("events", { keyPath: "id" });
      events.createIndex("observedAt", "observedAt");
      const problems = database.createObjectStore("problems", { keyPath: "slug" });
      problems.createIndex("status", "status");
      problems.createIndex("lastSolvedAt", "lastSolvedAt");
      const cards = database.createObjectStore("cards", { keyPath: "slug" });
      cards.createIndex("due", "due");
      const logs = database.createObjectStore("logs", { keyPath: "id" });
      logs.createIndex("slug", "slug");
      logs.createIndex("reviewedAt", "reviewedAt");
      database.createObjectStore("kv");
    },
  });

  await db.put("problems", problem("two-sum", ["leetcode"]));
  await db.put("problems", problem("is-anagram", ["neetcode"]));
  await db.put("problems", problem("both", ["neetcode", "leetcode"]));

  await db.put("cards", legacyCard("two-sum", T0 + DAY));
  await db.put("cards", legacyCard("is-anagram", T0 + 2 * DAY));
  await db.put("cards", legacyCard("both", T0 + 3 * DAY));
  await db.put("cards", legacyCard("orphan", T0 + 4 * DAY));

  await db.put("logs", {
    id: "two-sum:5",
    slug: "two-sum",
    rating: 3,
    reviewedAt: 5,
    elapsedDays: 1,
    scheduledDays: 2,
    phase: "review",
    source: "manual",
  });

  await db.put("events", {
    id: "leetcode:submission_result:two-sum:0:1",
    type: "submission_result",
    provider: "leetcode",
    slug: "two-sum",
    verdict: "accepted",
    submittedAt: T0,
    observedAt: T0,
  });
  await db.put("events", {
    id: "neetcode:problem_solved:is-anagram:0:completed",
    type: "problem_solved",
    provider: "neetcode",
    slug: "is-anagram",
    solvedAt: T0,
    observedAt: T0,
  });

  await db.put("kv", { activeTrack: "leetcode" }, "settings");
  db.close();
  return name;
}

async function migrated() {
  dbCounter += 1;
  const name = await seedLegacyDb(`lcs-migration-${dbCounter}`);
  return createIdbStore(await openLcsDb(name));
}

describe("upgrading a version 1 database", () => {
  it("keeps every card, without duplicating any", async () => {
    const store = await migrated();

    expect(await store.cards.all()).toHaveLength(4);
  });

  it("routes cards by where their problem's evidence came from", async () => {
    const store = await migrated();

    expect(await store.cards.get("leetcode", "two-sum")).toBeDefined();
    expect(await store.cards.get("neetcode", "two-sum")).toBeUndefined();

    expect(await store.cards.get("neetcode", "is-anagram")).toBeDefined();
    expect(await store.cards.get("leetcode", "is-anagram")).toBeUndefined();
  });

  it("puts a problem seen by both providers in exactly one track", async () => {
    const store = await migrated();

    // LeetCode wins the tie: its history carries real solve dates, so that's the
    // schedule worth preserving. The other track fills in on the next sync.
    expect(await store.cards.get("leetcode", "both")).toBeDefined();
    expect(await store.cards.get("neetcode", "both")).toBeUndefined();
  });

  it("sends a card with no matching problem to NeetCode", async () => {
    const store = await migrated();

    expect(await store.cards.get("neetcode", "orphan")).toBeDefined();
  });

  it("preserves the FSRS state it was carrying, not just the identity", async () => {
    const store = await migrated();
    const card = await store.cards.get("leetcode", "two-sum");

    expect(card).toMatchObject({
      due: T0 + DAY,
      stability: 4.2,
      difficulty: 6.1,
      reps: 5,
      lapses: 1,
      phase: "review",
      lastReview: T0,
    });
  });

  it("re-keys logs onto their track and keeps them findable", async () => {
    const store = await migrated();

    const found = await store.logs.forProblem("leetcode", "two-sum");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "leetcode:two-sum:5", track: "leetcode", rating: 3 });

    // And not under the track it didn't come from.
    expect(await store.logs.forProblem("neetcode", "two-sum")).toEqual([]);
  });

  it("leaves events and settings alone", async () => {
    const store = await migrated();

    expect((await store.settings.get()).activeTrack).toBe("leetcode");
    expect(await store.events.count()).toBe(2);
  });

  it("empties problem state, because the merged rows can't be split", async () => {
    // v4 keys problem state by (provider, slug). The old rows carried a solve date from
    // one site and an attempt count from the other, so there is nothing to attribute —
    // they're dropped here and refolded from the log on the next open.
    const store = await migrated();

    expect(await store.problems.all()).toEqual([]);
  });

  it("backfills the provider index over events that predate it", async () => {
    // The index arrived in v3; rows written under v1 have to end up in it, or a
    // per-provider count silently reports zero on every existing install.
    const store = await migrated();

    expect(await store.events.count("leetcode")).toBe(1);
    expect(await store.events.count("neetcode")).toBe(1);
  });

  it("serves the migrated cards through a track-scoped due query", async () => {
    const store = await migrated();

    const due = await store.cards.due("leetcode", T0 + 10 * DAY);
    expect(due.map((c) => c.slug)).toEqual(["two-sum", "both"]);

    const neetcode = await store.cards.due("neetcode", T0 + 10 * DAY);
    expect(neetcode.map((c) => c.slug)).toEqual(["is-anagram", "orphan"]);
  });

  it("refolds problem state per provider when opened the normal way", async () => {
    dbCounter += 1;
    const name = await seedLegacyDb(`lcs-migration-rebuild-${dbCounter}`);
    const store = await createDefaultStore(name);

    // One row per (provider, slug), each carrying only what that provider observed.
    const leetcode = await store.problems.get("leetcode", "two-sum");
    const neetcode = await store.problems.get("neetcode", "is-anagram");

    expect(leetcode).toMatchObject({ provider: "leetcode", attempts: 1, hasDatedSolve: true });
    expect(neetcode).toMatchObject({ provider: "neetcode", attempts: 0, hasDatedSolve: false });

    // And no cross-contamination: neither provider gained the other's problem.
    expect(await store.problems.get("neetcode", "two-sum")).toBeUndefined();
    expect(await store.problems.get("leetcode", "is-anagram")).toBeUndefined();
  });

  it("doesn't refold a database that already has state", async () => {
    dbCounter += 1;
    const name = await seedLegacyDb(`lcs-migration-norebuild-${dbCounter}`);
    const first = await createDefaultStore(name);
    await first.problems.put([
      { ...(await first.problems.get("leetcode", "two-sum"))!, attempts: 99 },
    ]);

    // A second open must leave the store as it found it, or every restart would discard
    // whatever the last sync wrote.
    const second = await createDefaultStore(name);
    expect((await second.problems.get("leetcode", "two-sum"))?.attempts).toBe(99);
  });

  it("is idempotent — reopening an already-migrated database changes nothing", async () => {
    dbCounter += 1;
    const name = await seedLegacyDb(`lcs-migration-reopen-${dbCounter}`);

    const first = await openLcsDb(name);
    const before = await createIdbStore(first).cards.all();
    first.close();

    const second = await openLcsDb(name);
    const after = await createIdbStore(second).cards.all();

    expect(after).toEqual(before);
  });
});

/**
 * The v5 repair: a card that exists but can never be read back.
 *
 * IndexedDB refuses `NaN` as an index key, so a card with a non-finite `due` is skipped
 * by every read that goes through `[track, due]` — the queue, the badge, the browse list —
 * while `get` and export still return it. Seeding then builds its "already exists" set
 * from the same index, sees the card missing, and re-creates it on every sync. `cards.put`
 * refuses to write one now; this is for the databases that already have one.
 */
async function seedDbWithBrokenCard(name: string): Promise<string> {
  const db = await openDB(name, 4, {
    upgrade(database) {
      const events = database.createObjectStore("events", { keyPath: "id" });
      events.createIndex("observedAt", "observedAt");
      events.createIndex("provider", "provider");
      const problems = database.createObjectStore("problems", { keyPath: ["provider", "slug"] });
      problems.createIndex("provider", "provider");
      const cards = database.createObjectStore("cards", { keyPath: ["track", "slug"] });
      cards.createIndex("trackDue", ["track", "due"]);
      const logs = database.createObjectStore("logs", { keyPath: "id" });
      logs.createIndex("trackSlug", ["track", "slug"]);
      logs.createIndex("reviewedAt", "reviewedAt");
      database.createObjectStore("kv");
    },
  });

  await db.put("cards", { ...legacyCard("two-sum", T0 + DAY), track: "leetcode" });
  await db.put("cards", { ...legacyCard("broken", Number.NaN), track: "leetcode" });
  db.close();
  return name;
}

describe("upgrading a version 4 database", () => {
  async function upgraded() {
    dbCounter += 1;
    const name = await seedDbWithBrokenCard(`lcs-v5-${dbCounter}`);
    return createIdbStore(await openLcsDb(name));
  }

  it("gives an unschedulable card a due date so it stops being invisible", async () => {
    const store = await upgraded();

    const cards = await store.cards.all("leetcode");
    expect(cards.map((card) => card.slug).sort()).toEqual(["broken", "two-sum"]);
    expect(Number.isFinite(cards.find((card) => card.slug === "broken")?.due)).toBe(true);
  });

  it("keeps the review history the broken card was carrying", async () => {
    const store = await upgraded();
    const repaired = await store.cards.get("leetcode", "broken");

    // Rescheduling it is the repair; throwing away its FSRS state would be a second bug.
    expect(repaired).toMatchObject({ stability: 4.2, reps: 5, lapses: 1, phase: "review" });
  });

  it("counts it, now that the index can see it", async () => {
    const store = await upgraded();

    expect(await store.cards.count("leetcode")).toBe(2);
  });

  it("indexes solved problems by provider and status", async () => {
    // The v5 index has to exist over rows written before it did.
    const store = await upgraded();
    await store.problems.put([
      {
        provider: "leetcode",
        slug: "two-sum",
        status: "solved",
        firstSolvedAt: T0,
        lastSolvedAt: T0,
        attempts: 1,
        acceptedCount: 1,
        hasDatedSolve: true,
        listChecked: {},
        updatedAt: T0,
      },
    ]);

    expect(await store.problems.countSolved("leetcode")).toBe(1);
    expect(await store.problems.countSolved("neetcode")).toBe(0);
  });
});
