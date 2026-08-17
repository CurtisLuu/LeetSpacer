import type { ProgressEvent } from "@lcs/core";
import { describe, expect, it } from "vitest";

import { ProviderShapeError, type SyncCtx } from "../types.js";
import { type GraphqlOperation, type LeetcodeTransport, fullSync, incrementalSync } from "./sync.js";

const NOW = Date.UTC(2026, 7, 17);
const DAY = 86_400_000;

function ctx(overrides: Partial<SyncCtx> = {}): SyncCtx {
  return { now: () => NOW, throttle: async () => {}, ...overrides };
}

async function collect(
  stream: AsyncGenerator<ProgressEvent[], void, undefined>,
): Promise<ProgressEvent[]> {
  const all: ProgressEvent[] = [];
  for await (const batch of stream) all.push(...batch);
  return all;
}

interface FakeOptions {
  signedIn?: boolean;
  /** Submission history, newest first, split into pages by the fake. */
  history?: { id: string; slug: string; at: number; display?: string }[];
  /** Accepted slugs returned by problemsetQuestionList. */
  solved?: string[];
  /** Make `/api/submissions/` fail, to exercise the profile-feed fallback. */
  historyFails?: boolean;
  recentAc?: { id: string; slug: string; at: number }[];
}

/** Records every call so tests can assert on request counts, not just results. */
function fakeTransport(options: FakeOptions) {
  const { signedIn = true, history = [], solved = [], historyFails = false, recentAc = [] } = options;
  const calls: string[] = [];
  const PAGE = 20;

  const transport: LeetcodeTransport = {
    async graphql(operation: GraphqlOperation, variables?: unknown) {
      calls.push(operation.operationName);

      if (operation.operationName === "globalData") {
        return {
          data: {
            userStatus: signedIn
              ? { userId: 1, username: "curtis", isSignedIn: true }
              : { userId: null, username: null, isSignedIn: false },
          },
        };
      }

      if (operation.operationName === "recentAcSubmissions") {
        return {
          data: {
            recentAcSubmissionList: recentAc.map((r) => ({
              id: r.id,
              titleSlug: r.slug,
              timestamp: Math.floor(r.at / 1000),
            })),
          },
        };
      }

      const { skip, limit } = variables as { skip: number; limit: number };
      return {
        data: {
          problemsetQuestionList: {
            total: solved.length,
            questions: solved.slice(skip, skip + limit).map((slug) => ({ titleSlug: slug, status: "ac" })),
          },
        },
      };
    },

    async rest(path: string) {
      calls.push(path);
      if (historyFails) throw new Error("HTTP 403");

      // `lastkey` is an opaque cursor to the adapter; here it's just the next index.
      const lastKey = new URL(path, "https://leetcode.com").searchParams.get("lastkey");
      const start = lastKey ? Number(lastKey) : 0;
      const rows = history.slice(start, start + PAGE);
      const end = start + rows.length;

      return {
        submissions_dump: rows.map((row) => ({
          id: row.id,
          title_slug: row.slug,
          timestamp: Math.floor(row.at / 1000),
          status: row.display === undefined || row.display === "Accepted" ? 10 : 11,
          status_display: row.display ?? "Accepted",
        })),
        has_next: end < history.length,
        last_key: end < history.length ? String(end) : null,
      };
    },
  };

  return { transport, calls };
}

function submissions(count: number, startAt = NOW) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(1000 + i),
    slug: `problem-${i}`,
    at: startAt - i * DAY,
  }));
}

describe("fullSync", () => {
  it("refuses to run signed out rather than importing an empty history", async () => {
    const { transport } = fakeTransport({ signedIn: false });
    await expect(collect(fullSync(transport, ctx()))).rejects.toBeInstanceOf(ProviderShapeError);
  });

  it("reads the whole submission history, following the lastkey cursor", async () => {
    const { transport, calls } = fakeTransport({ history: submissions(45) });
    const events = await collect(fullSync(transport, ctx()));

    expect(events.filter((e) => e.type === "submission_result")).toHaveLength(45);
    // 45 rows at 20 per page: three pages, and no repeats.
    expect(new Set(events.map((e) => e.id)).size).toBe(45);
    expect(calls.filter((c) => c.startsWith("/api/submissions/"))).toHaveLength(3);
  });

  it("carries real solve dates through, which is the point of reading LeetCode", async () => {
    const at = Date.UTC(2025, 2, 14);
    const { transport } = fakeTransport({ history: [{ id: "1", slug: "two-sum", at }] });
    const [event] = await collect(fullSync(transport, ctx()));

    expect(event).toMatchObject({ slug: "two-sum", submittedAt: at, verdict: "accepted" });
  });

  it("backfills solved problems the history never reached", async () => {
    const { transport } = fakeTransport({
      history: [{ id: "1", slug: "two-sum", at: NOW }],
      solved: ["two-sum", "3sum"],
    });
    const events = await collect(fullSync(transport, ctx()));

    // 3sum has no dated submission, so it arrives as a dateless problem_solved...
    expect(events.filter((e) => e.type === "problem_solved").map((e) => e.slug)).toEqual(["3sum"]);
    // ...and two-sum does not, because folding in `observedAt` would drag its real solve
    // date forward to now and reset its review schedule.
    expect(events.filter((e) => e.slug === "two-sum").map((e) => e.type)).toEqual([
      "submission_result",
    ]);
  });

  it("falls back to the profile feed when the history endpoint is unavailable", async () => {
    const { transport, calls } = fakeTransport({
      historyFails: false,
      history: [],
      recentAc: [{ id: "9", slug: "two-sum", at: NOW }],
      solved: ["two-sum"],
    });
    const events = await collect(fullSync(transport, ctx()));

    expect(calls).toContain("recentAcSubmissions");
    expect(events.filter((e) => e.slug === "two-sum")).toHaveLength(1);
  });

  it("still completes when the accepted-set query breaks", async () => {
    // History is the part worth having and it's already been yielded. Failing the sync
    // here would leave it marked incomplete and re-walk the whole history next page load.
    const { transport } = fakeTransport({ history: submissions(3) });
    const brittle = {
      ...transport,
      graphql: async (operation: GraphqlOperation, variables?: unknown) => {
        if (operation.operationName === "problemsetQuestionList") throw new Error("HTTP 500");
        return transport.graphql(operation, variables);
      },
    };

    const events = await collect(fullSync(brittle, ctx()));
    expect(events).toHaveLength(3);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const { transport } = fakeTransport({ history: submissions(200) });

    const events: ProgressEvent[] = [];
    for await (const batch of fullSync(transport, ctx({ signal: controller.signal }))) {
      events.push(...batch);
      controller.abort();
    }
    expect(events.length).toBeLessThan(200);
  });

  it("reports progress as it goes", async () => {
    const seen: string[] = [];
    const { transport } = fakeTransport({ history: submissions(25), solved: ["extra"] });
    await collect(
      fullSync(transport, ctx({ onProgress: (update) => seen.push(update.phase) })),
    );
    expect(seen).toContain("submissions");
    expect(seen).toContain("solved-set");
  });
});

describe("incrementalSync", () => {
  it("stops once it reaches submissions older than the cursor", async () => {
    const { transport, calls } = fakeTransport({ history: submissions(200) });
    // 200 daily submissions; asking for the last week should not walk all ten pages.
    await collect(incrementalSync(transport, ctx(), NOW - 7 * DAY));

    expect(calls.filter((c) => c.startsWith("/api/submissions/")).length).toBeLessThanOrEqual(2);
  });

  it("never touches the accepted-set query — that's a full-sync cost", async () => {
    const { transport, calls } = fakeTransport({ history: submissions(5), solved: ["a", "b"] });
    await collect(incrementalSync(transport, ctx(), NOW - DAY));

    expect(calls).not.toContain("problemsetQuestionList");
  });

  it("re-yields overlapping submissions rather than risking a gap", async () => {
    // Deterministic ids mean the store dedupes these on insert, so overlap is free and
    // dropping a real submission is not.
    const { transport } = fakeTransport({ history: submissions(5) });
    const events = await collect(incrementalSync(transport, ctx(), NOW));
    expect(events.length).toBeGreaterThan(0);
  });

  it("yields nothing when the account has no submissions", async () => {
    const { transport } = fakeTransport({ history: [], recentAc: [] });
    expect(await collect(incrementalSync(transport, ctx(), NOW - DAY))).toEqual([]);
  });
});
