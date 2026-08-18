import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory-store.js";
import type { ProblemState, ProgressEvent, ReviewCard, ReviewLog } from "./model.js";
import {
  InvalidRecordError,
  isProviderId,
  isTrackId,
  validateAll,
  validateCard,
  validateEvent,
  validateLog,
  validateProblemState,
} from "./validate.js";

const T0 = Date.UTC(2026, 0, 1);

const CARD: ReviewCard = {
  track: "leetcode",
  slug: "two-sum",
  due: T0,
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

const PROBLEM: ProblemState = {
  provider: "neetcode",
  slug: "two-sum",
  status: "solved",
  firstSolvedAt: T0,
  lastSolvedAt: T0,
  attempts: 2,
  acceptedCount: 1,
  hasDatedSolve: false,
  listChecked: {},
  updatedAt: T0,
};

const EVENT: ProgressEvent = {
  id: "leetcode:submission_result:two-sum:1",
  type: "submission_result",
  provider: "leetcode",
  slug: "two-sum",
  verdict: "accepted",
  submittedAt: T0,
  observedAt: T0,
};

const LOG: ReviewLog = {
  id: "leetcode:two-sum:1",
  track: "leetcode",
  slug: "two-sum",
  rating: 3,
  reviewedAt: T0,
  elapsedDays: 1,
  scheduledDays: 2,
  phase: "review",
  source: "manual",
};

describe("track and provider identity", () => {
  it("knows the two, and only the two", () => {
    expect(isTrackId("leetcode")).toBe(true);
    expect(isTrackId("neetcode")).toBe(true);
    expect(isTrackId("codewars")).toBe(false);
    expect(isTrackId("")).toBe(false);
    expect(isTrackId(undefined)).toBe(false);
    expect(isProviderId("hackerrank")).toBe(false);
  });
});

describe("validateCard", () => {
  it("passes a well-formed card through unchanged", () => {
    expect(validateCard(CARD)).toBe(CARD);
  });

  it("rejects a due date that isn't a finite number", () => {
    // The reason this file exists — see the header there.
    for (const due of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "soon"]) {
      expect(() => validateCard({ ...CARD, due })).toThrow(/due must be a finite timestamp/);
    }
  });

  it("rejects a card filed under a track that doesn't exist", () => {
    expect(() => validateCard({ ...CARD, track: "codewars" })).toThrow(/track must be/);
    expect(() => validateCard({ ...CARD, track: undefined })).toThrow(/track must be/);
  });

  it("rejects the rest of the scheduling state when it isn't numeric", () => {
    expect(() => validateCard({ ...CARD, stability: null })).toThrow(/stability/);
    expect(() => validateCard({ ...CARD, reps: "5" })).toThrow(/reps/);
    expect(() => validateCard({ ...CARD, phase: "asleep" })).toThrow(/phase/);
  });

  it("names the card it is complaining about", () => {
    // The message is read by whoever just tried to import a file, so it has to say which
    // record and which field, not "invalid card".
    expect(() => validateCard({ ...CARD, due: null })).toThrow(/two-sum/);
  });
});

describe("validateProblemState, validateEvent and validateLog", () => {
  it("pass well-formed records", () => {
    expect(validateProblemState(PROBLEM)).toBe(PROBLEM);
    expect(validateEvent(EVENT)).toBe(EVENT);
    expect(validateLog(LOG)).toBe(LOG);
  });

  it("reject records from a site that isn't one of the two", () => {
    expect(() => validateProblemState({ ...PROBLEM, provider: "codewars" })).toThrow(/provider/);
    expect(() => validateEvent({ ...EVENT, provider: "codewars" })).toThrow(/provider/);
    expect(() => validateLog({ ...LOG, track: "codewars" })).toThrow(/track/);
  });

  it("reject a missing or unreadable timestamp", () => {
    expect(() => validateEvent({ ...EVENT, submittedAt: undefined })).toThrow(/submittedAt/);
    expect(() => validateEvent({ ...EVENT, observedAt: "yesterday" })).toThrow(/observedAt/);
    expect(() => validateProblemState({ ...PROBLEM, updatedAt: Number.NaN })).toThrow(/updatedAt/);
  });

  it("reject an event type nothing knows how to fold", () => {
    expect(() => validateEvent({ ...EVENT, type: "problem_starred" })).toThrow(/unknown type/);
  });
});

describe("validateAll", () => {
  it("says which position went wrong", () => {
    const records = [CARD, CARD, { ...CARD, due: null }];

    expect(() => validateAll(records, validateCard)).toThrow(/position 2/);
  });

  it("throws the typed error, so callers can rewrite the message", () => {
    try {
      validateAll([{ ...CARD, due: null }], validateCard);
      expect.unreachable("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(InvalidRecordError);
      expect((cause as InvalidRecordError).kind).toBe("review card");
    }
  });
});

describe("the store as the enforcement point", () => {
  it("refuses bad records at the write, not at the read", async () => {
    const store = createMemoryStore();

    // Cast at each call: these are exactly the values TypeScript already forbids, which
    // is the point — the check is for what reaches the store at runtime, from an imported
    // file or a future adapter, where no compiler was involved.
    await expect(store.cards.put([{ ...CARD, due: Number.NaN }])).rejects.toThrow(/due/);
    await expect(
      store.events.append([{ ...EVENT, provider: "codewars" } as unknown as ProgressEvent]),
    ).rejects.toThrow(/provider/);
    await expect(
      store.logs.append([{ ...LOG, rating: 7 } as unknown as ReviewLog]),
    ).rejects.toThrow(/rating/);
    await expect(
      store.problems.put([{ ...PROBLEM, status: "maybe" } as unknown as ProblemState]),
    ).rejects.toThrow(/status/);
  });
});
