/**
 * Reading NeetCode's completed-problem set.
 *
 * NeetCode exposes the same structure in two places, and this handles both:
 *
 *   - `POST /api/callableFunctionHttp` with `{"data":{"functionId":"getCompletedProblems"}}`
 *     responds `{"data": {"<Topic>": ["<leetcode url>", …]}}`
 *   - `localStorage["synced-progress-cache"]` holds `{"completed": {"<Topic>": [...]}}`
 *
 * Both are read passively — the page requests the first one itself on load, and the
 * second is just sitting there. The extension issues no requests of its own and never
 * touches an auth token.
 *
 * The important property is that problems are identified by **LeetCode URL**. That makes
 * NeetCode's own slugs (`is-anagram`, `three-integer-sum`) irrelevant and lets everything
 * join straight to the bundled catalog for titles, difficulty, and tags.
 */

import { type ProgressEvent, type Timestamp, eventId } from "@lcs/core";

export interface CompletedProblem {
  /** The LeetCode titleSlug, which is our canonical key. */
  slug: string;
  /** NeetCode's roadmap topic, e.g. "Arrays & Hashing". */
  topic: string;
}

const LEETCODE_PROBLEM = /leetcode\.com\/problems\/([^/?#]+)/i;

export function slugFromLeetcodeUrl(url: string): string | null {
  const match = LEETCODE_PROBLEM.exec(url);
  return match?.[1] ? match[1].toLowerCase() : null;
}

function isTopicMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts the API response, the localStorage cache, or the bare topic map, so callers
 * don't have to know which surface a payload came from.
 */
export function parseCompletedProblems(raw: unknown): CompletedProblem[] {
  let topics: unknown = raw;

  if (isTopicMap(topics) && "data" in topics) topics = topics.data;
  if (isTopicMap(topics) && "completed" in topics) topics = topics.completed;
  if (!isTopicMap(topics)) return [];

  const seen = new Set<string>();
  const completed: CompletedProblem[] = [];

  for (const [topic, urls] of Object.entries(topics)) {
    if (!Array.isArray(urls)) continue;
    for (const url of urls) {
      if (typeof url !== "string") continue;
      const slug = slugFromLeetcodeUrl(url);
      // A problem can appear under more than one topic; first listing wins.
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      completed.push({ slug, topic });
    }
  }

  return completed;
}

/**
 * Turn the completed set into events.
 *
 * NeetCode reports *that* a problem is done, never when. The event id therefore omits
 * the timestamp — otherwise every sync would mint a new event and keep pushing the solve
 * date forward, resetting the review schedule each time. With a stable id, the first
 * sync records the date and later syncs are no-ops.
 */
export function completedToEvents(
  completed: readonly CompletedProblem[],
  observedAt: Timestamp,
): ProgressEvent[] {
  return completed.map((problem) => ({
    id: eventId("neetcode", "problem_solved", problem.slug, 0, "completed"),
    type: "problem_solved",
    provider: "neetcode",
    slug: problem.slug,
    solvedAt: observedAt,
    observedAt,
  }));
}

/** Does this look like the callable-function response we care about? */
export function isCompletedProblemsCall(requestBody: string): boolean {
  return requestBody.includes("getCompletedProblems");
}

export const PROGRESS_CACHE_KEY = "synced-progress-cache";
