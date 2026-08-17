/**
 * Reading submission history out of a git repository.
 *
 * Kept separate from the conversion logic so that stays pure and testable. One `git log`
 * pass gets every file's first-add commit — the alternative, a `git log` per file, is
 * hundreds of subprocesses for a repo this size.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { type RepoSubmission, parseSubmissionPath } from "./neetcode-github.js";

const RECORD_MARKER = "\u0001";

export class RepoReadError extends Error {}

function git(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new RepoReadError(
      `git ${args.join(" ")} failed in ${repoPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Map every tracked file to the commit date that first introduced it.
 * `--diff-filter=A` restricts to additions; `--reverse` means the first sighting of a
 * path is its earliest, so later rewrites don't overwrite the original date.
 */
export function firstAddedDates(repoPath: string): Map<string, number> {
  const output = git(repoPath, [
    // Without this, paths with non-ASCII characters come back quoted and escaped.
    "-c",
    "core.quotePath=false",
    "log",
    "--diff-filter=A",
    "--reverse",
    `--format=${RECORD_MARKER}%at`,
    "--name-only",
  ]);

  const dates = new Map<string, number>();
  let currentTimestamp: number | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith(RECORD_MARKER)) {
      currentTimestamp = Number.parseInt(line.slice(RECORD_MARKER.length), 10) * 1000;
      continue;
    }
    const path = line.trim();
    if (!path || currentTimestamp === null) continue;
    if (!dates.has(path)) dates.set(path, currentTimestamp);
  }

  return dates;
}

/** Read a NeetCode GitHub Sync checkout into the submissions the importer consumes. */
export function readNeetcodeRepo(repoPath: string): RepoSubmission[] {
  const root = resolve(repoPath);

  if (!existsSync(root)) throw new RepoReadError(`No such directory: ${root}`);
  if (!existsSync(resolve(root, ".git"))) {
    throw new RepoReadError(
      `${root} is not a git checkout. Clone the repository rather than downloading a zip — ` +
        "the commit dates are what make this worth importing.",
    );
  }

  const dates = firstAddedDates(root);
  const submissions: RepoSubmission[] = [];
  const skipped: string[] = [];

  for (const [path, committedAt] of dates) {
    const parsed = parseSubmissionPath(path);
    if (!parsed) {
      if (path !== "README.md") skipped.push(path);
      continue;
    }
    submissions.push({
      problemSlug: parsed.problemSlug,
      index: parsed.index,
      path,
      committedAt,
    });
  }

  if (submissions.length === 0) {
    throw new RepoReadError(
      `Found no files matching <course>/<problem>/submission-N.<ext> in ${root}. ` +
        `Skipped ${skipped.length} unrecognized paths.`,
    );
  }

  return submissions;
}
