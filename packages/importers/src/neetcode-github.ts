/**
 * Imports a NeetCode GitHub Sync repository.
 *
 * NeetCode's GitHub integration commits every submission as
 * `<course>/<problem-slug>/submission-N.<ext>`, one commit per submission. That gives us
 * three things scraping never would: which problems were solved, how many attempts each
 * took, and — from the commit dates — *when*. The last of those is what lets spaced
 * repetition schedule from real history instead of from the day you installed.
 *
 * Everything here is pure. Reading the repository lives in `git.ts` so this can be
 * tested without a filesystem.
 */

import {
  type ProgressEvent,
  type StoreSnapshot,
  type Timestamp,
  DEFAULT_SETTINGS,
  createScheduler,
  eventId,
  foldEvents,
  withDefaults,
} from "@lcs/core";

/** One `submission-N.<ext>` file, with the commit that introduced it. */
export interface RepoSubmission {
  /** The NeetCode problem slug — the directory name. */
  problemSlug: string;
  /** N from `submission-N`. */
  index: number;
  path: string;
  committedAt: Timestamp;
}

/** `<course>/<problem-slug>/submission-<n>.<ext>` */
const SUBMISSION_PATH = /^(?<course>[^/]+)\/(?<slug>[^/]+)\/submission-(?<index>\d+)\.(?<ext>\w+)$/;

export function parseSubmissionPath(
  path: string,
): { course: string; problemSlug: string; index: number; ext: string } | null {
  const match = SUBMISSION_PATH.exec(path);
  if (!match?.groups) return null;
  return {
    course: match.groups.course!,
    problemSlug: match.groups.slug!,
    index: Number.parseInt(match.groups.index!, 10),
    ext: match.groups.ext!,
  };
}

export interface ImportOptions {
  /**
   * Treat the highest-numbered submission as the accepted one.
   *
   * NeetCode lets you sync either all submissions or accepted-only, and the files carry
   * no verdict either way. People stop submitting once a problem passes, so the last
   * submission being the successful one is the safe reading. Earlier ones are recorded
   * with an unknown verdict, which still counts as an attempt — that's the signal that
   * a problem was a struggle.
   */
  assumeLastAccepted?: boolean;
}

export function toProgressEvents(
  submissions: readonly RepoSubmission[],
  options: ImportOptions = {},
): ProgressEvent[] {
  const assumeLastAccepted = options.assumeLastAccepted ?? true;
  const byProblem = new Map<string, RepoSubmission[]>();

  for (const submission of submissions) {
    const bucket = byProblem.get(submission.problemSlug);
    if (bucket) bucket.push(submission);
    else byProblem.set(submission.problemSlug, [submission]);
  }

  const events: ProgressEvent[] = [];

  for (const [slug, group] of byProblem) {
    const ordered = [...group].sort((a, b) => a.index - b.index || a.committedAt - b.committedAt);

    for (const [position, submission] of ordered.entries()) {
      const isLast = position === ordered.length - 1;
      const verdict = assumeLastAccepted && isLast ? "accepted" : "other";

      events.push({
        id: eventId(
          "neetcode",
          "submission_result",
          slug,
          submission.committedAt,
          String(submission.index),
        ),
        type: "submission_result",
        provider: "neetcode",
        slug,
        verdict,
        submittedAt: submission.committedAt,
        observedAt: submission.committedAt,
      });
    }
  }

  return events.sort((a, b) => a.observedAt - b.observedAt);
}

export interface SnapshotOptions extends ImportOptions {
  now: Timestamp;
  requestRetention?: number;
}

export interface ImportSummary {
  problems: number;
  submissions: number;
  events: number;
  cardsSeeded: number;
  dueNow: number;
  earliestSolve: Timestamp | null;
  latestSolve: Timestamp | null;
}

/**
 * Build the snapshot the extension's Import JSON button consumes.
 *
 * Cards are seeded from each problem's most recent solve, so a problem finished in May
 * shows up already overdue rather than starting a fresh schedule today.
 */
export function buildSnapshot(
  submissions: readonly RepoSubmission[],
  options: SnapshotOptions,
): { snapshot: StoreSnapshot; summary: ImportSummary } {
  const events = toProgressEvents(submissions, options);
  const problems = [...foldEvents(new Map(), events).values()];

  const scheduler = createScheduler({
    requestRetention: options.requestRetention ?? DEFAULT_SETTINGS.requestRetention,
  });

  const cards = problems
    .filter((problem) => problem.status === "solved" && problem.lastSolvedAt !== null)
    .map((problem) => scheduler.seed(problem.slug, problem.lastSolvedAt!, problem.attempts));

  const solveTimes = problems
    .map((problem) => problem.lastSolvedAt)
    .filter((at): at is number => at !== null);

  const snapshot: StoreSnapshot = {
    version: 1,
    exportedAt: options.now,
    events,
    problems,
    cards,
    logs: [],
    settings: withDefaults({
      providers: {
        ...DEFAULT_SETTINGS.providers,
        neetcode: {
          ...DEFAULT_SETTINGS.providers.neetcode,
          enabled: true,
          lastFullSyncAt: options.now,
          lastIncrementalSyncAt: options.now,
        },
      },
    }),
  };

  return {
    snapshot,
    summary: {
      problems: problems.length,
      submissions: submissions.length,
      events: events.length,
      cardsSeeded: cards.length,
      dueNow: cards.filter((card) => card.due <= options.now).length,
      earliestSolve: solveTimes.length > 0 ? Math.min(...solveTimes) : null,
      latestSolve: solveTimes.length > 0 ? Math.max(...solveTimes) : null,
    },
  };
}
