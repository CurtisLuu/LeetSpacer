import { describe, expect, it } from "vitest";

import {
  checkToEvent,
  isSubmissionCheckUrl,
  parseRecentAc,
  parseSolvedPage,
  parseSubmissionCheck,
  parseSubmissionPage,
  parseUserStatus,
  slugFromProblemUrl,
  solvedToEvents,
  submissionEventId,
  submissionIdFromCheckUrl,
  toMillis,
  toVerdict,
} from "./parse.js";

const OBSERVED = Date.UTC(2026, 7, 17);

/** Shaped after a real `/api/submissions/` page; extra fields kept to prove they're ignored. */
function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1122334455",
    lang: "python3",
    time: "2 weeks, 3 days",
    timestamp: 1_750_000_000,
    status: 10,
    status_display: "Accepted",
    runtime: "52 ms",
    url: "/submissions/detail/1122334455/",
    is_pending: "Not Pending",
    title: "Two Sum",
    memory: "17.1 MB",
    code: "class Solution: ...",
    title_slug: "two-sum",
    ...overrides,
  };
}

describe("parseUserStatus", () => {
  it("reads a signed-in session", () => {
    const raw = { data: { userStatus: { userId: 7, username: "curtis", isSignedIn: true } } };
    expect(parseUserStatus(raw)).toEqual({ signedIn: true, username: "curtis" });
  });

  it("treats a signed-out session as no-session", () => {
    const raw = { data: { userStatus: { userId: null, username: null, isSignedIn: false } } };
    expect(parseUserStatus(raw)).toEqual({ signedIn: false, reason: "no-session" });
  });

  it("treats an unrecognized shape as unknown, not signed in", () => {
    expect(parseUserStatus({ data: {} })).toEqual({ signedIn: false, reason: "unknown" });
    expect(parseUserStatus(null)).toEqual({ signedIn: false, reason: "unknown" });
  });

  it("won't call someone signed in without a username to attribute it to", () => {
    const raw = { data: { userStatus: { isSignedIn: true, username: "" } } };
    expect(parseUserStatus(raw)).toEqual({ signedIn: false, reason: "no-session" });
  });
});

describe("toMillis", () => {
  it("converts epoch seconds, as number or string", () => {
    expect(toMillis(1_750_000_000)).toBe(1_750_000_000_000);
    expect(toMillis("1750000000")).toBe(1_750_000_000_000);
  });

  it("rejects values that can't be a real submission date", () => {
    // The failure mode this guards: reading a field that holds milliseconds, or an id, as
    // if it were seconds, and inventing a solve date decades off.
    expect(toMillis(0)).toBeNull();
    expect(toMillis(-1)).toBeNull();
    expect(toMillis(946_684_800)).toBeNull(); // 2000 — before LeetCode existed
    expect(toMillis("not a time")).toBeNull();
    expect(toMillis(undefined)).toBeNull();
  });

  it("rejects a value that is already in milliseconds", () => {
    // The comment above promised both ends and only the lower one was checked. If
    // LeetCode ever reports these in milliseconds, multiplying by a thousand puts every
    // solve around the year 51,000 — and a card due then never comes due again, silently,
    // for everything in the account. Dropping the row is recoverable; a fabricated date
    // is not.
    expect(toMillis(1_750_000_000_000)).toBeNull();
    expect(toMillis("1750000000000")).toBeNull();
  });

  it("still accepts a submission from a few days in the future", () => {
    // Clock skew, not a shape change. The upper bound is decades out for this reason.
    expect(toMillis(Math.floor(Date.now() / 1000) + 3 * 86_400)).not.toBeNull();
  });
});

describe("toVerdict", () => {
  it("maps LeetCode's display strings", () => {
    expect(toVerdict("Accepted")).toBe("accepted");
    expect(toVerdict("Wrong Answer")).toBe("wrong_answer");
    expect(toVerdict("Time Limit Exceeded")).toBe("time_limit_exceeded");
    expect(toVerdict("Memory Limit Exceeded")).toBe("memory_limit_exceeded");
    expect(toVerdict("Runtime Error")).toBe("runtime_error");
    expect(toVerdict("Compile Error")).toBe("compile_error");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toVerdict("  accepted ")).toBe("accepted");
  });

  it("falls back to the numeric code when the display string is unknown", () => {
    expect(toVerdict("Something New", 11)).toBe("wrong_answer");
    expect(toVerdict(null, 10)).toBe("accepted");
  });

  it("degrades to other rather than guessing", () => {
    expect(toVerdict("Something New")).toBe("other");
    expect(toVerdict(null, 999)).toBe("other");
  });
});

describe("parseSubmissionPage", () => {
  it("turns rows into dated submission events", () => {
    const page = parseSubmissionPage(
      { submissions_dump: [submissionRow()], has_next: true, last_key: "abc123" },
      OBSERVED,
    );

    expect(page.events).toEqual([
      {
        id: "leetcode:submission_result:two-sum:0:1122334455",
        type: "submission_result",
        provider: "leetcode",
        slug: "two-sum",
        verdict: "accepted",
        submittedAt: 1_750_000_000_000,
        observedAt: OBSERVED,
      },
    ]);
    expect(page.lastKey).toBe("abc123");
    expect(page.hasNext).toBe(true);
    expect(page.oldestAt).toBe(1_750_000_000_000);
  });

  it("keeps failed submissions — they're what attempt counts are made of", () => {
    const page = parseSubmissionPage(
      {
        submissions_dump: [
          submissionRow({ id: "1", status: 11, status_display: "Wrong Answer" }),
          submissionRow({ id: "2" }),
        ],
      },
      OBSERVED,
    );
    expect(page.events.map((e) => e.type === "submission_result" && e.verdict)).toEqual([
      "wrong_answer",
      "accepted",
    ]);
  });

  it("produces identical ids across syncs, so re-syncing inserts nothing", () => {
    const once = parseSubmissionPage({ submissions_dump: [submissionRow()] }, OBSERVED);
    const twice = parseSubmissionPage({ submissions_dump: [submissionRow()] }, OBSERVED + 86_400_000);
    expect(once.events[0]!.id).toBe(twice.events[0]!.id);
  });

  it("drops rows it can't date or key rather than inventing values", () => {
    const page = parseSubmissionPage(
      {
        submissions_dump: [
          submissionRow({ timestamp: null }),
          submissionRow({ title_slug: undefined }),
          submissionRow({ id: "" }),
          "not an object",
        ],
      },
      OBSERVED,
    );
    expect(page.events).toEqual([]);
  });

  it("reports the oldest row, which is how an incremental sync knows to stop", () => {
    const page = parseSubmissionPage(
      {
        submissions_dump: [
          submissionRow({ id: "1", timestamp: 1_750_000_000 }),
          submissionRow({ id: "2", timestamp: 1_700_000_000 }),
        ],
      },
      OBSERVED,
    );
    expect(page.oldestAt).toBe(1_700_000_000_000);
  });

  it("survives an unexpected body", () => {
    expect(parseSubmissionPage({ detail: "Authentication required." }, OBSERVED)).toEqual({
      events: [],
      lastKey: null,
      hasNext: false,
      oldestAt: null,
    });
    expect(parseSubmissionPage(null, OBSERVED).events).toEqual([]);
  });
});

describe("parseSolvedPage", () => {
  const page = (questions: unknown[], total = 3) => ({
    data: { problemsetQuestionList: { total, questions } },
  });

  it("reads the accepted slugs", () => {
    const result = parseSolvedPage(
      page([
        { titleSlug: "two-sum", status: "ac" },
        { titleSlug: "3sum", status: "AC" },
      ]),
    );
    expect(result).toEqual({ slugs: ["two-sum", "3sum"], total: 3 });
  });

  it("ignores rows the server didn't mark accepted", () => {
    // A signed-out request returns this same shape with a null status for every row —
    // trusting the filter alone would import the entire problem set as solved.
    const result = parseSolvedPage(
      page([
        { titleSlug: "two-sum", status: null },
        { titleSlug: "3sum", status: "notac" },
      ]),
    );
    expect(result.slugs).toEqual([]);
  });

  it("survives an unexpected body", () => {
    expect(parseSolvedPage({ data: {} })).toEqual({ slugs: [], total: null });
    expect(parseSolvedPage(undefined)).toEqual({ slugs: [], total: null });
  });
});

describe("solvedToEvents", () => {
  it("omits the timestamp from the id so re-syncing can't move the solve date", () => {
    const first = solvedToEvents(["two-sum"], OBSERVED);
    const later = solvedToEvents(["two-sum"], OBSERVED + 7 * 86_400_000);
    expect(first[0]!.id).toBe(later[0]!.id);
    expect(first[0]!.id).toBe("leetcode:problem_solved:two-sum:0:ac-list");
  });
});

describe("parseRecentAc", () => {
  it("reads the profile feed as accepted submissions", () => {
    const raw = {
      data: {
        recentAcSubmissionList: [
          { id: "99", title: "Two Sum", titleSlug: "two-sum", timestamp: "1750000000" },
        ],
      },
    };
    expect(parseRecentAc(raw, OBSERVED)).toEqual([
      {
        id: "leetcode:submission_result:two-sum:0:99",
        type: "submission_result",
        provider: "leetcode",
        slug: "two-sum",
        verdict: "accepted",
        submittedAt: 1_750_000_000_000,
        observedAt: OBSERVED,
      },
    ]);
  });

  it("survives an unexpected body", () => {
    expect(parseRecentAc({ data: { recentAcSubmissionList: null } }, OBSERVED)).toEqual([]);
    expect(parseRecentAc({}, OBSERVED)).toEqual([]);
  });
});

describe("the live submission poll", () => {
  it("recognizes the judge's check URL", () => {
    expect(isSubmissionCheckUrl("https://leetcode.com/submissions/detail/1234/check/")).toBe(true);
    expect(isSubmissionCheckUrl("/submissions/detail/1234/check/")).toBe(true);
    expect(isSubmissionCheckUrl("https://leetcode.com/graphql/")).toBe(false);
    expect(isSubmissionCheckUrl("/submissions/detail/1234/")).toBe(false);
    // The observer uses this as its allow-list, so a path fragment on another host must
    // never satisfy it.
    expect(isSubmissionCheckUrl("https://evil.example/submissions/detail/1234/check/")).toBe(false);
    expect(isSubmissionCheckUrl("http://leetcode.com/submissions/detail/1234/check/")).toBe(false);
  });

  it("ignores the poll's in-progress responses", () => {
    expect(parseSubmissionCheck({ state: "PENDING" })).toBeNull();
    expect(parseSubmissionCheck({ state: "STARTED" })).toBeNull();
  });

  it("reads the final verdict", () => {
    expect(
      parseSubmissionCheck({ state: "SUCCESS", status_code: 10, status_msg: "Accepted" }),
    ).toEqual({ verdict: "accepted", finished: true });

    expect(
      parseSubmissionCheck({ state: "SUCCESS", status_code: 11, status_msg: "Wrong Answer" }),
    ).toEqual({ verdict: "wrong_answer", finished: true });
  });

  it("survives an unexpected body", () => {
    expect(parseSubmissionCheck({ state: "SUCCESS" })).toBeNull();
    expect(parseSubmissionCheck("nope")).toBeNull();
  });

  it("takes the submission id from the URL, since the body has none", () => {
    expect(submissionIdFromCheckUrl("/submissions/detail/1122334455/check/")).toBe("1122334455");
    expect(submissionIdFromCheckUrl("/graphql/")).toBeNull();
  });

  it("gives a live verdict the same id the history sync will produce for it", () => {
    // Without this, submitting with the panel open and later running a full sync would
    // count the same submission twice and inflate the attempt count.
    const live = checkToEvent(
      { verdict: "accepted", finished: true },
      "two-sum",
      "1122334455",
      OBSERVED,
    );
    const historical = parseSubmissionPage({ submissions_dump: [submissionRow()] }, OBSERVED);

    expect(live.id).toBe(historical.events[0]!.id);
    expect(live.id).toBe(submissionEventId("two-sum", "1122334455"));
  });

  it("dates a live verdict as now, which is when it actually happened", () => {
    const event = checkToEvent({ verdict: "wrong_answer", finished: true }, "3sum", "7", OBSERVED);
    expect(event).toMatchObject({
      slug: "3sum",
      verdict: "wrong_answer",
      submittedAt: OBSERVED,
      observedAt: OBSERVED,
    });
  });
});

describe("slugFromProblemUrl", () => {
  it("reads the slug from a problem page and its sub-tabs", () => {
    expect(slugFromProblemUrl("https://leetcode.com/problems/two-sum/")).toBe("two-sum");
    expect(slugFromProblemUrl("https://leetcode.com/problems/two-sum/submissions/1234/")).toBe(
      "two-sum",
    );
    expect(slugFromProblemUrl("https://leetcode.com/problems/Two-Sum/?envType=list")).toBe(
      "two-sum",
    );
  });

  it("returns null anywhere else on the site", () => {
    expect(slugFromProblemUrl("https://leetcode.com/problemset/")).toBeNull();
    expect(slugFromProblemUrl("https://neetcode.io/problems/two-integer-sum")).toBeNull();
  });
});
