import { describe, expect, it } from "vitest";

import { type SyncFailure, describeSyncFailure, isStorageFull } from "./errors.js";

const ALL: SyncFailure[] = [
  "signed-out",
  "session-expired",
  "unreachable",
  "site-changed",
  "not-ready",
  "storage-full",
  "unknown",
];

describe("describeSyncFailure", () => {
  it("names the site the reader was actually on", () => {
    expect(describeSyncFailure("signed-out", "neetcode").title).toContain("NeetCode");
    expect(describeSyncFailure("signed-out", "leetcode").detail).toContain("leetcode.com");
  });

  it("covers every failure", () => {
    for (const failure of ALL) {
      const message = describeSyncFailure(failure, "leetcode");
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.detail.length).toBeGreaterThan(0);
    }
  });

  it("never leaks implementation detail into the interface", () => {
    // The whole point: an endpoint name or a status code tells the reader nothing they
    // can act on, and this is the last place either could reach them.
    const leaks = [
      /http\s?\d{3}/i,
      /\bapi\b/i,
      /endpoint/i,
      /token/i,
      /pnpm/i,
      /IndexedDB/i,
      /firebase/i,
      /graphql/i,
      /slug/i,
      /catalog/i,
      /undefined|null|NaN/,
    ];

    for (const provider of ["leetcode", "neetcode"] as const) {
      for (const failure of ALL) {
        const { title, detail } = describeSyncFailure(failure, provider);
        for (const leak of leaks) {
          expect(`${title} ${detail}`).not.toMatch(leak);
        }
      }
    }
  });

  it("always tells the reader what to do next", () => {
    for (const failure of ALL) {
      // Every message ends in an instruction, not a description of the problem.
      expect(describeSyncFailure(failure, "neetcode").detail).toMatch(
        /Sign in|Reload|Check your connection|Open|Reinstalling|Free up space|will be needed/,
      );
    }
  });
});

describe("isStorageFull", () => {
  it("recognises the browser refusing a write", () => {
    // Recognised by name and by the legacy numeric code, because which one is set
    // depends on the engine.
    expect(isStorageFull({ name: "QuotaExceededError", message: "…" })).toBe(true);
    expect(isStorageFull({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    expect(isStorageFull({ name: "DataError", code: 22 })).toBe(true);
  });

  it("recognises it after a trip across the message boundary", () => {
    // A handler's throw reaches the content script as a plain Error with the message
    // flattened into a string, which is how this used to be classified "unknown" and
    // reported as something retrying would fix.
    expect(isStorageFull(new Error("events:ingest failed: QuotaExceededError: quota exceeded"))).toBe(
      true,
    );
    expect(isStorageFull("QuotaExceededError")).toBe(true);
  });

  it("doesn't claim an ordinary failure", () => {
    expect(isStorageFull(new Error("Failed to fetch"))).toBe(false);
    expect(isStorageFull({ name: "AbortError" })).toBe(false);
    expect(isStorageFull(null)).toBe(false);
    expect(isStorageFull(undefined)).toBe(false);
  });
});

describe("a full profile, described", () => {
  it("says what to do instead of telling you to retry", () => {
    const message = describeSyncFailure("storage-full", "leetcode");

    // The one failure retrying cannot fix, so it must not read like the others.
    expect(message.detail).not.toMatch(/again|retry/i);
    expect(message.detail).toMatch(/free up space|export/i);
  });
});
