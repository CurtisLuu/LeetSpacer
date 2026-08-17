/**
 * NeetCode's GitHub Sync writes structured commit messages:
 *
 *   Add: climbing-stairs - submission-0
 *
 * That's a gift for the API-based importer — the commit list alone identifies which
 * problem and which attempt each commit represents, so a whole repository resolves in one
 * or two requests instead of one per file.
 *
 * Not every commit follows it. Repository initialization and the "Bulk sync: N
 * submissions" commit that lands your back catalogue both need the file list fetched
 * separately, which is why `parse` returning null is a normal outcome, not an error.
 */

export interface ParsedCommit {
  problemSlug: string;
  index: number;
}

const ADD_SUBMISSION = /^Add:\s+(?<slug>[^\s]+)\s+-\s+submission-(?<index>\d+)\s*$/i;

export function parseCommitMessage(message: string): ParsedCommit | null {
  // GitHub returns the full message; only the subject line carries the convention.
  const subject = message.split("\n", 1)[0] ?? "";
  const match = ADD_SUBMISSION.exec(subject.trim());
  if (!match?.groups) return null;

  const index = Number.parseInt(match.groups.index!, 10);
  if (!Number.isFinite(index)) return null;

  return { problemSlug: match.groups.slug!, index };
}

/** True for commits whose contents we have to fetch to understand. */
export function needsFileList(message: string): boolean {
  return parseCommitMessage(message) === null;
}
