import { describe, expect, it } from "vitest";

import { type SyncFailure, describeSyncFailure } from "./errors.js";

const ALL: SyncFailure[] = [
  "signed-out",
  "session-expired",
  "unreachable",
  "site-changed",
  "not-ready",
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
        /Sign in|Reload|Check your connection|Open|Reinstalling|will be needed/,
      );
    }
  });
});
