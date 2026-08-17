import type { ProgressEvent } from "@lcs/core";
import { describe, expect, it } from "vitest";

type SubmissionEvent = Extract<ProgressEvent, { type: "submission_result" }>;

const acceptedOnly = (events: ProgressEvent[]): SubmissionEvent[] =>
  events.filter(
    (event): event is SubmissionEvent =>
      event.type === "submission_result" && event.verdict === "accepted",
  );

import {
  type RepoSubmission,
  buildSnapshot,
  parseSubmissionPath,
  toProgressEvents,
} from "./neetcode-github.js";

const DAY = 86_400_000;
const NOW = 1_786_929_717_000; // 2026-08-16
const MAY = NOW - 90 * DAY;

function submission(slug: string, index: number, committedAt: number): RepoSubmission {
  return {
    problemSlug: slug,
    index,
    path: `Data Structures & Algorithms/${slug}/submission-${index}.py`,
    committedAt,
  };
}

describe("parseSubmissionPath", () => {
  it("parses the layout NeetCode's GitHub sync produces", () => {
    expect(parseSubmissionPath("Data Structures & Algorithms/is-anagram/submission-3.py")).toEqual({
      course: "Data Structures & Algorithms",
      problemSlug: "is-anagram",
      index: 3,
      ext: "py",
    });
  });

  it("handles other courses and languages", () => {
    expect(parseSubmissionPath("Python For Beginners/python-hello-world/submission-0.ts")).toEqual({
      course: "Python For Beginners",
      problemSlug: "python-hello-world",
      index: 0,
      ext: "ts",
    });
  });

  it("rejects paths that aren't submissions", () => {
    expect(parseSubmissionPath("README.md")).toBeNull();
    expect(parseSubmissionPath("Course/problem/notes.md")).toBeNull();
    expect(parseSubmissionPath("Course/problem/submission-x.py")).toBeNull();
  });
});

describe("toProgressEvents", () => {
  it("marks the last submission accepted and earlier ones as attempts", () => {
    const events = toProgressEvents([
      submission("surrounded-regions", 0, MAY),
      submission("surrounded-regions", 1, MAY + 60_000),
      submission("surrounded-regions", 2, MAY + 120_000),
    ]);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type === "submission_result" && e.verdict)).toEqual([
      "other",
      "other",
      "accepted",
    ]);
  });

  it("treats a single submission as an accepted solve", () => {
    const [event] = toProgressEvents([submission("binary-search", 0, MAY)]);

    expect(event).toMatchObject({ type: "submission_result", verdict: "accepted", slug: "binary-search" });
  });

  it("gives every submission a distinct id even at the same timestamp", () => {
    const events = toProgressEvents([
      submission("permutations", 0, MAY),
      submission("permutations", 1, MAY),
    ]);

    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it("orders submissions by index, not by the order they were read", () => {
    const events = toProgressEvents([
      submission("permutations", 2, MAY + 2),
      submission("permutations", 0, MAY),
      submission("permutations", 1, MAY + 1),
    ]);

    const accepted = acceptedOnly(events);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.submittedAt).toBe(MAY + 2);
  });

  it("keeps problems independent", () => {
    const events = toProgressEvents([
      submission("two-sum", 0, MAY),
      submission("binary-search", 0, MAY + DAY),
    ]);

    const accepted = acceptedOnly(events);
    expect(accepted.map((e) => e.slug).sort()).toEqual(["binary-search", "two-sum"]);
  });
});

describe("buildSnapshot", () => {
  const submissions = [
    submission("two-sum", 0, MAY),
    submission("surrounded-regions", 0, MAY + DAY),
    submission("surrounded-regions", 1, MAY + DAY + 60_000),
    submission("surrounded-regions", 2, MAY + DAY + 120_000),
    submission("climbing-stairs", 0, NOW - 60_000),
  ];

  it("counts attempts from the number of submissions", () => {
    const { snapshot } = buildSnapshot(submissions, { now: NOW });
    const struggled = snapshot.problems.find((p) => p.slug === "surrounded-regions");

    expect(struggled?.attempts).toBe(3);
    expect(struggled?.acceptedCount).toBe(1);
    expect(struggled?.status).toBe("solved");
  });

  it("seeds a card per solved problem", () => {
    const { snapshot, summary } = buildSnapshot(submissions, { now: NOW });

    expect(summary.problems).toBe(3);
    expect(summary.cardsSeeded).toBe(3);
    expect(snapshot.cards.map((c) => c.slug).sort()).toEqual([
      "climbing-stairs",
      "surrounded-regions",
      "two-sum",
    ]);
  });

  it("makes old solves due and recent ones not", () => {
    const { snapshot, summary } = buildSnapshot(submissions, { now: NOW });

    const old = snapshot.cards.find((c) => c.slug === "two-sum");
    const recent = snapshot.cards.find((c) => c.slug === "climbing-stairs");

    expect(old?.due).toBeLessThan(NOW);
    expect(recent?.due).toBeGreaterThan(NOW);
    expect(summary.dueNow).toBe(2);
  });

  it("reports the real solve range", () => {
    const { summary } = buildSnapshot(submissions, { now: NOW });

    expect(summary.earliestSolve).toBe(MAY);
    expect(summary.latestSolve).toBe(NOW - 60_000);
  });

  it("produces a snapshot the store can import", () => {
    const { snapshot } = buildSnapshot(submissions, { now: NOW });

    expect(snapshot.version).toBe(1);
    expect(snapshot.settings.providers.neetcode.lastFullSyncAt).toBe(NOW);
    // Round-trips through JSON, since that's how it reaches the extension.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
