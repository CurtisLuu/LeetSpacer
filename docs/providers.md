# Provider recon (P0)

What each site exposes, how we read it, and what still needs verifying. Every adapter
in `packages/providers` should trace back to something recorded here, with a captured
response in `fixtures/` backing it.

**Ground rules for everything in this document.** We read only the signed-in user's own
data, only from a content script running on that origin (so their cookies apply and we
never make a cross-origin request or handle a credential), throttled via
`createThrottle`, and never from a server.

---

## LeetCode

### Confirmed

**Public problem catalog — `problemsetQuestionList`.** Verified working unauthenticated
on 2026-08-16 by `packages/catalog/scripts/build-catalog.ts`; returned 4,028 problems
across 41 pages of 100. This is a developer build step, not runtime behaviour.

```
POST https://leetcode.com/graphql/
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput)
  -> questionList { total: totalNum, questions: data { acRate difficulty
       frontendQuestionId: questionFrontendId paidOnly: isPaidOnly title titleSlug
       topicTags { slug } } }
```

Notes: `acRate` comes back as a percentage and is stored as 0..1. 780 of 4,028 problems
are Premium-only. 175 distinct topic tags. No auth header or CSRF token was needed for
this query.

### To verify — use capture mode

The extension records this for you. Load it, open the side panel, tick **Record LeetCode
API shapes**, then walk the checklist it shows — it ticks each item off as the matching
operation is observed. Export when all five are covered and drop the JSON in
`fixtures/leetcode/`.

The MAIN-world observer (`lib/network-observer.ts`) records both request and response
bodies for anything matching `/graphql|/submissions/`, capped at three examples per
operation so the export is a set of distinct shapes rather than a log of your browsing.
Capture mode is off by default and writes to a separate IndexedDB database
(`leetcode-spaced-captures`) that is deleted along with the rest of this scaffolding once
P2 lands.

Manual DevTools capture works too, if you'd rather: filter Network to `graphql` and save
the request *and* response for each row below.

| # | Page to visit | What we need | Why it matters |
|---|---|---|---|
| 1 | `leetcode.com/progress/` | The query backing the solved/attempted list — name, variables, and whether it returns a **per-problem last-submitted timestamp** | This is the spine of spaced repetition. Without a per-problem timestamp we can only schedule from the moment of install. |
| 2 | `leetcode.com/problemset/` while signed in | Whether `problemsetQuestionList` accepts a `status: AC` filter and returns `status` per question | Paginated fallback for the full solved set if #1 changes shape. |
| 3 | Profile page | `recentAcSubmissionList(username, limit)` — shape and how far back it reaches | Cheap incremental delta; the default sync path. |
| 4 | A solved problem's submissions tab | The per-question submission history query — attempt counts, verdicts, timestamps | Weakness mining (≥3 attempts) and deriving a grade when the user dismisses the rating prompt. |
| 5 | Submit any problem | The exact URL and body of the submission-check poll, and the field holding `Accepted` / `Wrong Answer` | Fires the post-accept rating prompt. Narrows the deliberately-broad filter in `entrypoints/leetcode-hook.content.ts`. |

Also confirm: does a mutating or user-scoped query require an `x-csrftoken` header taken
from the `csrftoken` cookie? Record the answer — the adapter reads that cookie via
`document.cookie` on the same origin.

### Fallback

If a query name or shape changes, the adapter falls back to parsing the rendered
progress/problemset tables. Slower and less complete, but it keeps the extension alive
between fixes. Fixture-replay tests fail loudly when the primary path drifts.

---

## NeetCode

### Confirmed — this is the live data path

Captured 2026-08-16 from a signed-in session. **The extension makes no request of its own
and handles no auth token**; the page fetches this on load and we read the response.

```
POST https://neetcode.io/api/callableFunctionHttp
  {"data":{"functionId":"getCompletedProblems"}}
->
  {"data": {"Arrays & Hashing": ["https://leetcode.com/problems/contains-duplicate/", …],
            "Two Pointers":     [...], …}}
```

The same structure is cached at `localStorage["synced-progress-cache"]` under a
`completed` key, which covers reloads where the page doesn't refetch.

**Problems are identified by LeetCode URL.** This is the single most useful fact about
NeetCode's data: it means NeetCode's own slugs (`is-anagram`, `three-integer-sum`,
`buy-and-sell-crypto`) never enter the system, and everything joins directly to the
bundled catalogue for titles, difficulty, and topic tags. The topic key is NeetCode's
roadmap grouping.

Verified against a real account: 76 problems across 12 topics, parsed by
`packages/providers/src/neetcode/progress.ts`.

Other callable functions seen on the same endpoint, not currently used:
`getUserStreakData` (daily activity counts, useful if per-problem dates are ever wanted),
`getUserInfo`, `getActiveSaleCampaign`.

**What it does not carry: dates.** The completed set says *that* a problem is done, never
when. Cards therefore seed from the moment of first sync unless dates are supplied from
elsewhere — see the GitHub Sync repository below.

### Still unconfirmed

Curated list membership (Blind 75 / NC150 / NC250) and the roadmap's prerequisite edges.
The hand-seeded DAG in `packages/catalog/data/roadmap.json` remains a guess; the topic
*names* returned above match it, which is a partial corroboration.

A DOM capture found no `a[href*="leetcode.com"]` anchors on the practice page, so the
earlier plan of scraping problem rows for the join key was wrong — and unnecessary, given
the above.

### To verify — capture mode covers this too

NeetCode needs more than network capture, because the interesting state may never cross
the wire: anonymous progress lives in `localStorage`, and list membership is rendered
straight into the page. So the NeetCode content script also runs **snapshots** whenever
capture mode is on —

- `localStorage` (every key; values redacted when the key or content looks like a
  credential, since Firebase parks live auth tokens there),
- IndexedDB **database names only**, as a pointer for where to look next,
- the first 12 **problem rows**, found via `a[href*="leetcode.com"]` — those outbound
  links carry the `titleSlug` that joins the two sites, and the surrounding row markup
  shows how a solved item is marked.

Snapshots re-run on client-side navigation, so walking between `/practice` and `/roadmap`
captures both. What to check once the export is in:

1. **Anonymous progress.** With no account, tick a few problems on `neetcode.io/practice`
   and confirm the `localStorage` snapshot shows them. Record the exact keys and value
   shapes.
2. **Signed-in progress.** Sign in, then watch the Network tab for the call that loads
   progress (expected: Firestore, either REST or gRPC-web). Record the URL pattern and
   response shape. If it's only reachable as gRPC-web, prefer the DOM route below.
3. **DOM structure.** Capture the practice-table markup: how a solved row is marked, and
   how each row links out to LeetCode. The outbound href is how we recover the canonical
   `titleSlug` — this is the join key for the whole system.
4. **Roadmap edges.** Compare the live roadmap against the hand-seeded DAG in
   `packages/catalog/data/roadmap.json` and correct any differences. That seed is an
   informed guess, not a capture.
5. **List membership.** Capture which problems belong to Blind 75 / NC150 / NC250 and
   generate an overlay that fills `Problem.lists` and `Problem.roadmapTopic`. These are
   deliberately empty in the generated catalog rather than hardcoded, because neetcode.io
   is the authority and a hardcoded list drifts silently.

### Preference order

`localStorage`/IndexedDB → rendered DOM → observing the app's own network calls from the
MAIN world. The DOM is last-resort-proof: the checkmarks are what the user actually sees,
so if they're on screen we can read them.
