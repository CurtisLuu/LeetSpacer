/**
 * The GraphQL documents the LeetCode adapter sends.
 *
 * Kept as data, apart from the parsing and the transport, so that when LeetCode changes a
 * field there is exactly one place to correct — and so a fixture test can assert on the
 * operation name without a network call.
 *
 * All of these are the same operations leetcode.com's own pages issue. They run from a
 * content script on leetcode.com, so the user's existing session cookie applies and we
 * never see or store a credential.
 */

/** Who's signed in. LeetCode's own app calls this on every page load. */
export const USER_STATUS = {
  operationName: "globalData",
  query: `
query globalData {
  userStatus {
    userId
    username
    isSignedIn
    isPremium
  }
}`,
} as const;

/**
 * The signed-in user's accepted problems, paginated.
 *
 * This is the *complete* solved set, which submission history alone can't guarantee —
 * LeetCode truncates the history feed, so an account with years of activity would
 * otherwise lose its oldest solves. It carries no timestamps; those come from
 * `/api/submissions/`.
 */
export const SOLVED_QUESTIONS = {
  operationName: "problemsetQuestionList",
  query: `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      titleSlug
      status
    }
  }
}`,
  variables(skip: number, limit: number) {
    return { categorySlug: "", skip, limit, filters: { status: "AC" } };
  },
} as const;

/**
 * Recent accepted submissions with real timestamps.
 *
 * A cheap delta for the common case — LeetCode caps this at 20 and it's the same query
 * the profile page runs, so it costs one round trip to learn whether anything changed.
 */
export const RECENT_AC = {
  operationName: "recentAcSubmissions",
  query: `
query recentAcSubmissions($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id
    title
    titleSlug
    timestamp
  }
}`,
  variables(username: string, limit: number) {
    return { username, limit };
  },
} as const;

/**
 * Full submission history, including failures.
 *
 * REST rather than GraphQL, and the only source for the two things spaced repetition
 * actually needs: when each problem was solved, and how many attempts it took. Cursored
 * via `lastkey`; `offset` alone silently repeats pages once the history is long enough.
 */
export function submissionsPath(limit: number, lastKey: string | null): string {
  const params = new URLSearchParams({ offset: "0", limit: String(limit) });
  if (lastKey) params.set("lastkey", lastKey);
  return `/api/submissions/?${params.toString()}`;
}
