import type { ProgressEvent } from "@lcs/core";
import { describe, expect, it } from "vitest";

import type { ToLeetcodeSlug } from "./activity.js";
import { type NeetcodeSyncCtx, type NeetcodeTransport, fullSync, incrementalSync } from "./sync.js";

const NOW = Date.UTC(2026, 7, 17, 12);
const DAY = 86_400_000;

const toSlug: ToLeetcodeSlug = (nc) => (nc.startsWith("nc-") ? nc.slice(3) : null);

function ctx(overrides: Partial<NeetcodeSyncCtx> = {}): NeetcodeSyncCtx {
  return { now: () => NOW, throttle: async () => {}, toLeetcodeSlug: toSlug, ...overrides };
}

async function collect(
  stream: AsyncGenerator<ProgressEvent[], void, undefined>,
): Promise<ProgressEvent[]> {
  const all: ProgressEvent[] = [];
  for await (const batch of stream) all.push(...batch);
  return all;
}

/** Records each call so tests can assert on request counts, not just results. */
function fakeTransport(byDate: Record<string, string[]>, options: { failOn?: string } = {}) {
  const calls: string[] = [];

  const transport: NeetcodeTransport = {
    async callable(functionId, extra) {
      calls.push(functionId === "getUserDailyActivity" ? `day:${extra?.date}` : functionId);

      if (functionId === "getUserStreakData") {
        return {
          joined: "2025-11-21",
          activityByDate: Object.fromEntries(
            Object.entries(byDate).map(([date, slugs]) => [date, { count: slugs.length }]),
          ),
        };
      }

      const date = String(extra?.date);
      if (options.failOn === date) throw new Error("HTTP 500");
      return {
        date,
        submissions: (byDate[date] ?? []).map((slug, i) => ({
          problemId: slug,
          timestamp: `${date}T0${i}:00:00.000Z`,
          status: "Accepted",
        })),
      };
    },
  };

  return { transport, calls };
}

describe("fullSync", () => {
  it("fetches every active day and nothing else", async () => {
    const { transport, calls } = fakeTransport({
      "2026-08-15": ["nc-two-sum"],
      "2026-08-17": ["nc-3sum"],
    });

    const events = await collect(fullSync(transport, ctx()));

    expect(events.map((e) => e.slug).sort()).toEqual(["3sum", "two-sum"]);
    expect(calls).toEqual(["getUserStreakData", "day:2026-08-17", "day:2026-08-15"]);
  });

  it("carries the submission's own timestamp, which is the point", async () => {
    const { transport } = fakeTransport({ "2026-08-15": ["nc-two-sum"] });
    const [event] = await collect(fullSync(transport, ctx()));

    expect(event).toMatchObject({
      provider: "neetcode",
      slug: "two-sum",
      verdict: "accepted",
      submittedAt: Date.parse("2026-08-15T00:00:00.000Z"),
    });
  });

  it("walks newest first, so an interrupted sync still has the recent work", async () => {
    const { transport, calls } = fakeTransport({
      "2026-01-01": ["nc-a"],
      "2026-08-17": ["nc-b"],
      "2026-05-05": ["nc-c"],
    });
    await collect(fullSync(transport, ctx()));

    expect(calls.slice(1)).toEqual(["day:2026-08-17", "day:2026-05-05", "day:2026-01-01"]);
  });

  it("keeps going when one day fails", async () => {
    const { transport } = fakeTransport(
      { "2026-08-15": ["nc-two-sum"], "2026-08-16": ["nc-3sum"] },
      { failOn: "2026-08-16" },
    );

    // The rest of the history is still worth having, and the next sync retries that date.
    expect((await collect(fullSync(transport, ctx()))).map((e) => e.slug)).toEqual(["two-sum"]);
  });

  it("yields nothing when the account has no recorded activity", async () => {
    const { transport, calls } = fakeTransport({});
    expect(await collect(fullSync(transport, ctx()))).toEqual([]);
    expect(calls).toEqual(["getUserStreakData"]);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const days = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`2026-06-${String(i + 1).padStart(2, "0")}`, ["nc-x"]]),
    );
    const { transport, calls } = fakeTransport(days);

    for await (const _ of fullSync(transport, ctx({ signal: controller.signal }))) {
      controller.abort();
    }
    expect(calls.length).toBeLessThan(40);
  });
});

describe("incrementalSync", () => {
  it("only fetches days at or after the cursor", async () => {
    const { transport, calls } = fakeTransport({
      "2026-08-10": ["nc-old"],
      "2026-08-16": ["nc-recent"],
      "2026-08-17": ["nc-today"],
    });

    await collect(incrementalSync(transport, ctx(), NOW - DAY));

    // The cursor's own day is re-read — it may have gained submissions since — but
    // nothing older is touched.
    expect(calls).toEqual(["getUserStreakData", "day:2026-08-17", "day:2026-08-16"]);
  });

  it("re-reading a day inserts nothing new", async () => {
    const { transport } = fakeTransport({ "2026-08-17": ["nc-3sum"] });

    const first = await collect(incrementalSync(transport, ctx(), NOW - DAY));
    const second = await collect(incrementalSync(transport, ctx(), NOW - DAY));

    // Deterministic ids mean the store dedupes these; the walk needn't try to be clever.
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
  });
});
