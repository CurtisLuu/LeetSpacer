# Provider recon (P0)

What each site exposes, how we read it, and what still needs verifying. Every adapter
in `packages/providers` should trace back to something recorded here, with a captured
response in `fixtures/` backing it.

**Ground rules for everything in this document.** We read only the signed-in user's own
data, only from a content script running on that origin (so their session applies and we
never make a cross-origin request), throttled via `createThrottle`, and never from a
server. One credential is handled, in one place: NeetCode's activity walk borrows the
bearer token the page itself just used, because that site authenticates with a token
rather than a cookie. It is documented under **NeetCode** below and in `PRIVACY.md`, and
nothing else in the extension touches one.

---

## LeetCode

### Implemented — this is the live data path

Read by `entrypoints/leetcode.content.ts` (ISOLATED) and `leetcode-hook.content.ts`
(MAIN), parsed by `packages/providers/src/leetcode/`. Everything below runs same-origin
from a leetcode.com tab, throttled at ~1 request/second with jitter.

**Session — `globalData`.** One GraphQL round trip; the same call every LeetCode page
makes on load. A sync refuses to start unless this reports a username, so a signed-out
tab can never import an empty history over a real one.

```
POST /graphql/  { operationName: "globalData" }
-> { data: { userStatus: { userId, username, isSignedIn, isPremium } } }
```

**Submission history — `/api/submissions/`.** The primary source, and the only one that
carries dates. REST, not GraphQL.

```
GET /api/submissions/?offset=0&limit=20&lastkey=<cursor>
-> { submissions_dump: [ { id, title_slug, timestamp, status, status_display, lang, ... } ],
     has_next, last_key }
```

Notes:

- `timestamp` is epoch **seconds**. `parse.ts` refuses anything before 2010 rather than
  risk folding a misread field in as a solve date.
- Paginate by `lastkey`, **not** `offset` — offset paging repeats rows once a history is
  long enough, which would silently double-count attempts.
- Failed submissions are kept: they are what attempt counts are made of, and attempts are
  what seed a card's initial difficulty.
- Events are keyed on the submission id alone, deliberately excluding the timestamp, so a
  verdict seen live and the same submission seen later by a history sync are one event.

**Accepted set — `problemsetQuestionList(filters: {status: "AC"})`.** Dateless backfill
for problems the history didn't reach, since LeetCode truncates long histories. Rows are
only trusted when the row itself says `ac` — a signed-out request returns the same shape
with a null status for everything, and trusting the server-side filter alone would import
the entire problem set as solved. A failure here does not fail the sync.

**Live verdict — the judge poll.** The page polls this itself after you submit; the MAIN
world observer relays it.

```
GET /submissions/detail/<submissionId>/check/
-> { state: "PENDING" | "STARTED" | "SUCCESS", status_code, status_msg, ... }
```

Only `state: "SUCCESS"` is a result. The body carries no slug — the page URL identifies
the problem and the poll URL carries the submission id.

**Profile feed — `recentAcSubmissionList`.** Fallback only, used when `/api/submissions/`
returns nothing. Capped by LeetCode at 20 and accepted-only, so it cannot replace the
history walk.

**Public problem catalog — `problemsetQuestionList`.** Verified working unauthenticated
on 2026-08-16 by `packages/catalog/scripts/build-catalog.ts`; returned 4,028 problems
across 41 pages of 100. A developer build step, not runtime behaviour. `acRate` comes back
as a percentage and is stored as 0..1. 780 of 4,028 problems are Premium-only. 175
distinct topic tags. No auth header or CSRF token was needed for this query.

### Verified against a live signed-in account

The history sync was confirmed working on a real account on 2026-08-17. That single
observation settles most of the table below, because a sync that produces dated events at
all can only have done so by way of items 1, 2 and 4.

| # | Check | Status |
|---|---|---|
| 1 | `/api/submissions/` still returns `submissions_dump` with `title_slug` and `timestamp` | **Confirmed** — dated events were produced. |
| 2 | `lastkey` still cursors correctly and `has_next` terminates | **Confirmed** for the account tested. `phase: "submissions-truncated"` is reported if the 400-page cap ever trips. |
| 4 | Whether user-scoped queries require `x-csrftoken` from the `csrftoken` cookie | **Confirmed sufficient** — `createLeetcodeTransport` sends it when present and the requests were accepted. |

Two paths the history sync does not exercise, so they remain unconfirmed:

| # | Check | If it's wrong |
|---|---|---|
| 3 | `problemsetQuestionList` still accepts `filters: {status: "AC"}` and returns per-row `status` | Backfill yields nothing, so problems older than the history reach never get a card. Deliberately non-fatal: it's caught, reported as `phase: "solved-set-unavailable"`, and the sync still completes. Look for that phase in the console to tell. |
| 5 | The judge poll still uses `state`/`status_msg` | No live verdict when you submit with the panel open. Costs nothing permanent — the next history sync picks the submission up anyway. Confirm by submitting a problem and watching for `[lcs] <slug>: accepted`. |

Every one of these degrades rather than corrupts, which is the property the parsers were
written for: an unrecognized shape yields nothing instead of a wrong guess.

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

### Confirmed — the slug map, for linking *back* to NeetCode

The above holds for NeetCode's *progress* data. Its *pages* are a different matter, and
sending a user to NeetCode needs the reverse translation. Two public sources, both read by
`packages/catalog/scripts/build-neetcode-map.ts` (`pnpm neetcode:map`), neither requiring
an account:

1. **`neetcode.io/sitemap.xml`.** 588 `/problems/<nc-slug>` URLs — the set of NeetCode
   problem pages. Careful: the same sitemap's 973 `/solutions/<slug>` URLs are keyed by
   **LeetCode** slug, not NeetCode's. Mixing the two produces mappings that 404.
2. **The app bundle's rename table.** A literal `{"<nc-slug>": "<lc-slug>"}` object with
   73 entries, which NeetCode uses to normalize a slug before looking up a visualization.
   Chunk filenames are content-hashed, so the script rediscovers them from `/practice` →
   `runtime.<hash>.js` → the chunk table on every run, and locates the object by a known
   member rather than a minified variable name.

The other 514 problems keep LeetCode's slug, and that assumption is checked against the
bundled catalog — a NeetCode slug resolving to no known LeetCode problem is reported, not
written. Three needed a hand-written entry (`MANUAL_RENAMES` in the script), because
NeetCode only ships a rename entry for problems that have a visualization:
`reorder-linked-list`, `search-2d-matrix`, `merge-triplets-to-form-target`.

Result: 588 mappings in `packages/catalog/data/neetcode-slugs.json`. The remaining ~3,440
LeetCode problems have no NeetCode page and link to LeetCode instead.

Open question worth an hour with a browser: NeetCode publishes 973 solution pages but only
588 problem pages in its sitemap. If `/problems/<lc-slug>` also resolves for those other
385, coverage could nearly double. The sitemap is the published contract, so the map
sticks to it until someone confirms otherwise in a real browser — the site is an SPA that
returns HTTP 200 for every path, so this can't be settled with `curl`.

Verified against a real account: 76 problems across 12 topics, parsed by
`packages/providers/src/neetcode/progress.ts`.

Other callable functions seen on the same endpoint, not currently used:
`getUserStreakData` (daily activity counts, useful if per-problem dates are ever wanted),
`getUserInfo`, `getActiveSaleCampaign`.

**What it does not carry: dates.** The completed set says *that* a problem is done, never
when. Cards therefore seed from the moment of first sync unless dates are supplied from
elsewhere — see the GitHub Sync repository below.

### Confirmed — submission history

Probed against a live account on 2026-08-17. Two callables, both used by NeetCode's own
activity page, both reached at `POST /api/callableFunctionHttp` with a Firebase ID token:

```
{"data":{"functionId":"getUserStreakData"}}
-> { joined: "2025-11-21", activityByDate: { "2026-08-17": { count: 7, hasActivity: true }, … },
     currentStreak, maxStreak, … }

{"data":{"functionId":"getUserDailyActivity","date":"2026-08-17"}}
-> { date, totalSubmissions: 7, acceptedCount: 6,
     submissions: [ { problemId: "three-integer-sum", problemName: "3Sum",
                      difficulty: "Medium", language: "python",
                      timestamp: "2026-08-17T19:49:39.344Z", v2SubmissionIndex,
                      status: "Accepted", time, memory } ] }
```

Three things matter here:

- **`problemId` is NeetCode's slug**, not a display name, so the join is exact — the
  bundled slug map translates `three-integer-sum` to `3sum`. A slug the map doesn't know is
  dropped, never guessed at.
- **`timestamp` is ISO 8601**, unlike LeetCode's epoch seconds. Its own parser, because
  feeding one format to the other's parser yields a plausible-looking wrong date.
- **`activityByDate` bounds the walk.** One request per active day, no paging.

Coverage on the account probed: 58 active days, 71 of its 77 completed problems, 34 with
more than one submission. The remainder are problems ticked or solved elsewhere, which have
no submission record and stay dateless.

**This path does handle a credential**, which nothing else in the extension does. These
are Firebase callables and take a bearer token.

Do *not* read it from Firebase's IndexedDB. The stored copy expires hourly and is stale
far more often than not — that produced an HTTP 401 on every sync — and opening that
database creates it when absent, which is not ours to do on someone else's origin. The
MAIN-world observer relays the `Authorization` header off the page's own callable requests
instead; the page makes one on load, so the token used is by definition one that just
worked. Held in memory for the life of the tab, never stored or transmitted. A 401
mid-walk means it aged out, and the fix is to reload the page.

Two constraints on that observer, both load-bearing:

- **It sees one endpoint.** `isObservableNeetcodeUrl` allows `POST
  /api/callableFunctionHttp` on neetcode.io and nothing else — parsed, not pattern
  matched. The filter it replaced (`/firestore|googleapis|firebaseio|\/api\/|graphql/i`)
  also matched `identitytoolkit.googleapis.com/…:signInWithPassword` and
  `securetoken.googleapis.com/v1/token`, so signing in put an email, a plaintext password
  and a refresh token through it. A filter for an observer is an allow-list of endpoints
  the adapter consumes, never a guess at what looks interesting.
- **It reaches the extension, and only the extension.** Observations cross a private
  `MessageChannel` opened between the two worlds at `document_start`, before the page's
  first script runs — not `window.postMessage`, which every script on the origin can
  read and write. See `apps/extension/lib/page-bridge.ts`; nothing is patched at all
  until the ISOLATED world confirms the privacy policy was accepted.

### Still unconfirmed

Curated list membership (Blind 75 / NC150 / NC250) and the roadmap's prerequisite edges.
The hand-seeded DAG in `packages/catalog/data/roadmap.json` remains a guess; the topic
*names* returned above match it, which is a partial corroboration.

A DOM capture found no `a[href*="leetcode.com"]` anchors on the practice page, so the
earlier plan of scraping problem rows for the join key was wrong — and unnecessary, given
the above.

### Still open, and how to answer it by hand

> **No "capture mode" ships, and none ever did.** An earlier draft of this document
> described a mode in which the NeetCode content script snapshotted every `localStorage`
> key, the names of every IndexedDB database, and a sample of problem rows from the DOM.
> That was a plan, not code: no such snapshotting exists anywhere in the extension, and
> nothing like it may be added without a privacy-policy revision, because `PRIVACY.md`
> enumerates what is read. The plan is retired — what remains below is the list of things
> still unknown, to be answered with DevTools by hand.

1. **Anonymous progress.** With no account, tick a few problems on `neetcode.io/practice`
   and read `localStorage` in DevTools. Record the exact keys and value shapes. The
   adapter reads exactly one key today, `synced-progress-cache`.
2. **Signed-in progress.** Signed in, watch the Network tab for the call that loads
   progress. The shipped path reads it from the completed-problems callable the page makes
   on load; whether Firestore carries anything the callable doesn't is unconfirmed, and
   the observer is not permitted to look — its allow-list is neetcode.io's own callable
   endpoint and nothing else.
3. **Roadmap edges.** Compare the live roadmap against the hand-seeded DAG in
   `packages/catalog/data/roadmap.json` and correct any differences. That seed is an
   informed guess.
4. **List membership.** Work out which problems belong to Blind 75 / NC150 / NC250 and
   generate an overlay that fills `Problem.lists` and `Problem.roadmapTopic`. These are
   deliberately empty in the generated catalog rather than hardcoded, because neetcode.io
   is the authority and a hardcoded list drifts silently.

### Preference order

`localStorage` → observing the app's own network calls from the MAIN world → rendered DOM.
Whatever the source, it is read only if `PRIVACY.md` says it is, and the observer only
ever sees the exact endpoint the adapter consumes — see `isObservableNeetcodeUrl`.
