import { describe, expect, it } from "vitest";

import { applyEvent, foldEvents } from "./events.js";
import { type ProgressEvent, type ProviderId, eventId } from "./model.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function solved(slug: string, at: number, provider: ProviderId = "leetcode"): ProgressEvent {
  return {
    id: eventId(provider, "problem_solved", slug, at),
    type: "problem_solved",
    provider,
    slug,
    solvedAt: at,
    observedAt: at,
  };
}

function submission(
  slug: string,
  at: number,
  verdict: "accepted" | "wrong_answer",
): ProgressEvent {
  return {
    id: eventId("leetcode", "submission_result", slug, at),
    type: "submission_result",
    provider: "leetcode",
    slug,
    verdict,
    submittedAt: at,
    observedAt: at,
  };
}

function listChecked(slug: string, list: string, checked: boolean, at: number): ProgressEvent {
  return {
    id: eventId("neetcode", "list_checked", slug, at, list),
    type: "list_checked",
    provider: "neetcode",
    slug,
    list,
    checked,
    changedAt: at,
    observedAt: at,
  };
}

describe("applyEvent", () => {
  it("marks a problem solved and records first and last solve times", () => {
    const first = applyEvent(undefined, solved("two-sum", T0));
    const second = applyEvent(first, solved("two-sum", T0 + 10 * DAY));

    expect(second.status).toBe("solved");
    expect(second.firstSolvedAt).toBe(T0);
    expect(second.lastSolvedAt).toBe(T0 + 10 * DAY);
  });

  it("never regresses status when an older attempt arrives after a solve", () => {
    const afterSolve = applyEvent(undefined, solved("two-sum", T0));
    const afterStaleAttempt = applyEvent(afterSolve, {
      id: eventId("leetcode", "problem_attempted", "two-sum", T0 - DAY),
      type: "problem_attempted",
      provider: "leetcode",
      slug: "two-sum",
      attemptedAt: T0 - DAY,
      observedAt: T0 - DAY,
    });

    expect(afterStaleAttempt.status).toBe("solved");
  });

  it("counts attempts and accepted submissions separately", () => {
    let state = applyEvent(undefined, submission("valid-anagram", T0, "wrong_answer"));
    state = applyEvent(state, submission("valid-anagram", T0 + 60_000, "wrong_answer"));
    state = applyEvent(state, submission("valid-anagram", T0 + 120_000, "accepted"));

    expect(state.attempts).toBe(3);
    expect(state.acceptedCount).toBe(1);
    expect(state.status).toBe("solved");
    expect(state.firstSolvedAt).toBe(T0 + 120_000);
  });

  it("unions the providers that contributed evidence", () => {
    const fromLeetCode = applyEvent(undefined, solved("two-sum", T0, "leetcode"));
    const fromBoth = applyEvent(fromLeetCode, listChecked("two-sum", "neetcode150", true, T0 + DAY));

    expect(fromBoth.sources).toEqual(["leetcode", "neetcode"]);
    expect(fromBoth.listChecked).toEqual({ neetcode150: true });
  });

  it("treats a NeetCode checkmark as list state, not proof of a solve", () => {
    const state = applyEvent(undefined, listChecked("trapping-rain-water", "neetcode150", true, T0));

    expect(state.status).toBe("todo");
    expect(state.listChecked.neetcode150).toBe(true);
  });

  it("does not mutate the state it is given", () => {
    const before = applyEvent(undefined, solved("two-sum", T0));
    const snapshot = JSON.parse(JSON.stringify(before));
    applyEvent(before, listChecked("two-sum", "blind75", true, T0 + DAY));

    expect(before).toEqual(snapshot);
  });
});

describe("foldEvents", () => {
  it("produces the same state regardless of input order", () => {
    const events = [
      submission("two-sum", T0 + 2 * DAY, "accepted"),
      submission("two-sum", T0, "wrong_answer"),
      solved("two-sum", T0 + 5 * DAY),
    ];

    const forward = foldEvents(new Map(), events).get("two-sum");
    const reversed = foldEvents(new Map(), [...events].reverse()).get("two-sum");

    expect(forward).toEqual(reversed);
  });

  it("returns only the problems touched by this batch", () => {
    const initial = foldEvents(new Map(), [solved("two-sum", T0)]);
    const delta = foldEvents(initial, [solved("valid-anagram", T0 + DAY)]);

    expect([...delta.keys()]).toEqual(["valid-anagram"]);
  });

  it("carries forward existing state for problems in the batch", () => {
    const initial = foldEvents(new Map(), [submission("two-sum", T0, "wrong_answer")]);
    const delta = foldEvents(initial, [submission("two-sum", T0 + DAY, "accepted")]);

    expect(delta.get("two-sum")?.attempts).toBe(2);
    expect(delta.get("two-sum")?.status).toBe("solved");
  });

  it("marks a solve dated only when a submission carried its own timestamp", () => {
    // This is what tells seeding whether a card's due date can be trusted. An accepted
    // submission knows when it happened; a bare problem_solved does not.
    const dated = foldEvents(new Map(), [submission("two-sum", T0, "accepted")]);
    expect(dated.get("two-sum")?.hasDatedSolve).toBe(true);

    const undated = foldEvents(new Map(), [solved("valid-anagram", T0)]);
    expect(undated.get("valid-anagram")?.hasDatedSolve).toBe(false);
  });

  it("never lets a dateless sighting undo a real date", () => {
    // NeetCode reporting a problem complete after LeetCode already dated it must not
    // downgrade that problem back to "we don't know when".
    const initial = foldEvents(new Map(), [submission("two-sum", T0, "accepted")]);
    const later = foldEvents(initial, [solved("two-sum", T0 + 5 * DAY)]);

    expect(later.get("two-sum")?.hasDatedSolve).toBe(true);
  });

  it("leaves a failed submission undated", () => {
    const failed = foldEvents(new Map(), [submission("two-sum", T0, "wrong_answer")]);

    expect(failed.get("two-sum")?.hasDatedSolve).toBe(false);
    expect(failed.get("two-sum")?.status).toBe("attempted");
  });

  it("won't let a dateless report drag a real solve date forward", () => {
    // The failure this guards is severe and silent: you solved two-sum a year ago on
    // LeetCode, NeetCode reports it complete today, and the real date is replaced by
    // today's — so a card that should be long overdue looks freshly solved.
    const real = T0 - 365 * DAY;
    const state = foldEvents(new Map(), [
      submission("two-sum", real, "accepted"),
      solved("two-sum", T0),
    ]).get("two-sum");

    expect(state?.lastSolvedAt).toBe(real);
    expect(state?.hasDatedSolve).toBe(true);
  });

  it("reaches the same date whichever order the two arrive in", () => {
    const real = T0 - 365 * DAY;
    const events = [submission("two-sum", real, "accepted"), solved("two-sum", T0)];

    const forward = foldEvents(new Map(), events).get("two-sum");
    const reversed = foldEvents(new Map(), [...events].reverse()).get("two-sum");

    expect(forward?.lastSolvedAt).toBe(real);
    expect(reversed?.lastSolvedAt).toBe(real);
  });

  it("replaces a guessed date the moment a real one shows up", () => {
    // NeetCode first, so the only date available is "when we noticed". A later LeetCode
    // sync knows better and should overwrite it, not take the max of the two.
    const guessed = foldEvents(new Map(), [solved("two-sum", T0)]);
    expect(guessed.get("two-sum")?.lastSolvedAt).toBe(T0);

    const corrected = foldEvents(guessed, [
      submission("two-sum", T0 - 100 * DAY, "accepted"),
    ]);
    expect(corrected.get("two-sum")?.lastSolvedAt).toBe(T0 - 100 * DAY);
    expect(corrected.get("two-sum")?.firstSolvedAt).toBe(T0 - 100 * DAY);
  });

  it("still combines two real dates rather than replacing", () => {
    const state = foldEvents(new Map(), [
      submission("two-sum", T0 - 100 * DAY, "accepted"),
      submission("two-sum", T0 - 10 * DAY, "accepted"),
    ]).get("two-sum");

    expect(state?.firstSolvedAt).toBe(T0 - 100 * DAY);
    expect(state?.lastSolvedAt).toBe(T0 - 10 * DAY);
  });

  it("still accepts a dateless report when nothing better is known", () => {
    const state = foldEvents(new Map(), [solved("is-anagram", T0)]).get("is-anagram");

    expect(state?.lastSolvedAt).toBe(T0);
    expect(state?.status).toBe("solved");
  });
});
