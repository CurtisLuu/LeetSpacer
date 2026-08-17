import { afterEach, describe, expect, it, vi } from "vitest";

import { needsFileList, parseCommitMessage } from "./commit-message.js";
import { GithubError, fetchNeetcodeSubmissions, parseRepoRef } from "./github-api.js";

const REF = { owner: "someone", repo: "neetcode-submissions" };

function mockGithub(handler: (url: string) => { status?: number; body: unknown }) {
  vi.stubGlobal("fetch", (input: string) => {
    const { status = 200, body } = handler(String(input));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: () => Promise.resolve(body),
    } as Response);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("parseCommitMessage", () => {
  it("reads the message NeetCode's sync writes", () => {
    expect(parseCommitMessage("Add: climbing-stairs - submission-0")).toEqual({
      problemSlug: "climbing-stairs",
      index: 0,
    });
  });

  it("handles multi-digit submission numbers", () => {
    expect(parseCommitMessage("Add: surrounded-regions - submission-12")).toEqual({
      problemSlug: "surrounded-regions",
      index: 12,
    });
  });

  it("ignores anything after the subject line", () => {
    expect(parseCommitMessage("Add: two-sum - submission-1\n\nSome body text")).toEqual({
      problemSlug: "two-sum",
      index: 1,
    });
  });

  it("returns null for the commits that need their file list fetched", () => {
    // Both of these appear in a real synced repository.
    expect(parseCommitMessage("Bulk sync: 51 submissions")).toBeNull();
    expect(parseCommitMessage("Initialize NeetCode solutions repository")).toBeNull();

    expect(needsFileList("Bulk sync: 51 submissions")).toBe(true);
    expect(needsFileList("Add: two-sum - submission-0")).toBe(false);
  });

  it("rejects near-misses rather than guessing", () => {
    expect(parseCommitMessage("Add: two-sum - submission-x")).toBeNull();
    expect(parseCommitMessage("Update: two-sum - submission-0")).toBeNull();
    expect(parseCommitMessage("")).toBeNull();
  });
});

describe("fetchNeetcodeSubmissions", () => {
  it("treats an empty incremental result as 'nothing new', not an error", async () => {
    mockGithub(() => ({ body: [] }));

    const result = await fetchNeetcodeSubmissions(REF, { since: "2026-08-01T00:00:00Z" });

    expect(result.submissions).toEqual([]);
    expect(result.stats.incremental).toBe(true);
    expect(result.stats.requests).toBe(1);
  });

  it("still errors on an empty full sync, which means the repo is wrong", async () => {
    mockGithub(() => ({ body: [] }));

    await expect(fetchNeetcodeSubmissions(REF, {})).rejects.toThrow(GithubError);
  });

  it("passes the cutoff to GitHub rather than filtering after the fact", async () => {
    const seen: string[] = [];
    mockGithub((url) => {
      seen.push(url);
      return { body: [] };
    });

    await fetchNeetcodeSubmissions(REF, { since: "2026-08-01T00:00:00Z" });

    expect(seen[0]).toContain("since=2026-08-01T00%3A00%3A00Z");
  });

  it("reads problem and attempt from commit messages without fetching each commit", async () => {
    mockGithub(() => ({
      body: [
        {
          sha: "a1",
          commit: { message: "Add: two-sum - submission-0", author: { date: "2026-08-01T10:00:00Z" } },
        },
      ],
    }));

    const result = await fetchNeetcodeSubmissions(REF, {});

    expect(result.submissions).toEqual([
      {
        problemSlug: "two-sum",
        index: 0,
        path: "two-sum/submission-0",
        committedAt: Date.parse("2026-08-01T10:00:00Z"),
      },
    ]);
    // One request for the commit list, and no per-commit follow-up.
    expect(result.stats.requests).toBe(1);
    expect(result.stats.fromCommitMessages).toBe(1);
    expect(result.stats.fromFileLists).toBe(0);
  });

  it("falls back to the file list for a bulk-sync commit, and flags those dates", async () => {
    mockGithub((url) =>
      url.includes("/commits/bulk")
        ? {
            body: {
              files: [
                { filename: "Data Structures & Algorithms/two-sum/submission-0.py", status: "added" },
                { filename: "README.md", status: "added" },
              ],
            },
          }
        : {
            body: [
              {
                sha: "bulk",
                commit: {
                  message: "Bulk sync: 51 submissions",
                  author: { date: "2026-05-18T23:22:49Z" },
                },
              },
            ],
          },
    );

    const result = await fetchNeetcodeSubmissions(REF, {});

    expect(result.submissions.map((s) => s.problemSlug)).toEqual(["two-sum"]);
    expect(result.stats.fromFileLists).toBe(1);
    expect(result.stats.approximateDates).toBe(1);
    expect(result.stats.requests).toBe(2);
  });

  it("explains a rate limit rather than reporting a bare 403", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 403,
        headers: new Headers({ "x-ratelimit-remaining": "0" }),
        json: () => Promise.resolve({}),
      } as Response),
    );

    await expect(fetchNeetcodeSubmissions(REF, {})).rejects.toThrow(/rate limit/i);
  });
});

describe("parseRepoRef", () => {
  it("accepts the shorthand", () => {
    expect(parseRepoRef("CurtisLuu/neetcode-submissions")).toEqual({
      owner: "CurtisLuu",
      repo: "neetcode-submissions",
    });
  });

  it("accepts the forms people actually paste", () => {
    const expected = { owner: "CurtisLuu", repo: "neetcode-submissions" };

    expect(parseRepoRef("https://github.com/CurtisLuu/neetcode-submissions")).toEqual(expected);
    expect(parseRepoRef("https://github.com/CurtisLuu/neetcode-submissions/")).toEqual(expected);
    expect(parseRepoRef("https://github.com/CurtisLuu/neetcode-submissions.git")).toEqual(expected);
    expect(parseRepoRef("git@github.com:CurtisLuu/neetcode-submissions.git")).toEqual(expected);
    expect(parseRepoRef("  CurtisLuu/neetcode-submissions  ")).toEqual(expected);
  });

  it("keeps the repository name when the URL has extra path segments", () => {
    expect(parseRepoRef("https://github.com/CurtisLuu/neetcode-submissions/tree/main")).toEqual({
      owner: "CurtisLuu",
      repo: "neetcode-submissions",
    });
  });

  it("returns null for input that isn't a repository", () => {
    expect(parseRepoRef("")).toBeNull();
    expect(parseRepoRef("neetcode-submissions")).toBeNull();
    expect(parseRepoRef("https://neetcode.io/practice")).toBeNull();
  });
});
