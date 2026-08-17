import "fake-indexeddb/auto";

import type { ProblemState } from "@lcs/core";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";

import { createIdbStore, openLcsDb } from "./idb-store.js";

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

function problem(slug: string, sources: ProblemState["sources"]): ProblemState {
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

  it("leaves the other stores alone", async () => {
    const store = await migrated();

    expect(await store.problems.all()).toHaveLength(3);
    expect((await store.settings.get()).activeTrack).toBe("leetcode");
  });

  it("serves the migrated cards through a track-scoped due query", async () => {
    const store = await migrated();

    const due = await store.cards.due("leetcode", T0 + 10 * DAY);
    expect(due.map((c) => c.slug)).toEqual(["two-sum", "both"]);

    const neetcode = await store.cards.due("neetcode", T0 + 10 * DAY);
    expect(neetcode.map((c) => c.slug)).toEqual(["is-anagram", "orphan"]);
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
