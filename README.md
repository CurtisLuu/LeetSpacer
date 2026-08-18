# LeetSpacer

A Chrome extension that reads your own LeetCode and NeetCode progress and tells you what
to practice next — due reviews scheduled by spaced repetition, plus new problems chosen
to fill topic gaps, mined from failures, and weighted toward a target company.

Everything stays on your device. There is no backend and no account.

## How it collects your history

Both sources read the session you are already signed in with, from a content script on
that site's own origin. Nothing is configured, no token is entered, and nothing leaves
your machine. There is no manual sync button because there is no manual sync — the reading
happens inside a tab on the site, so opening one *is* the sync.

**LeetCode.** Open any page on `leetcode.com` while signed in. The extension walks your
submission history from `/api/submissions/` — the endpoint the site's own submissions page
uses — which carries **real per-submission timestamps and verdicts**. That's what lets
reviews be scheduled from when you actually solved something, and lets attempt counts
reflect how much a problem fought back. It then backfills your complete accepted set for
anything the history didn't reach. Submitting with a LeetCode tab open also records the
verdict the moment the judge returns it.

The first sync walks the whole history and takes a few minutes; after that it's a single
request, and at most one every fifteen minutes.

**NeetCode.** Open [neetcode.io/practice](https://neetcode.io/practice) while signed in.
Two things are read. The completed-problem set comes free — the page fetches it on load and
caches it in `localStorage`, so the extension reads what is already there. On top of that,
the extension walks NeetCode's own activity history, one request per day you were active,
which carries **per-submission timestamps and verdicts** exactly as LeetCode's does.

That walk needs a bearer token, because NeetCode authenticates with one rather than a
cookie. It is not read out of storage — the copy Firebase keeps there expires hourly and is
usually stale. Instead the token is taken from a request neetcode.io has already made
itself, held in memory for the life of the tab, used only for calls back to neetcode.io,
and never stored or transmitted. This is the one place the extension handles a credential
at all; if you would rather it did not, turn NeetCode off under Settings → Your history.

Both sources identify problems by **LeetCode slug**, so both join straight to the bundled
catalogue for real titles, difficulty, and topic tags. See
[`docs/providers.md`](docs/providers.md) for the exact shapes.

Note that the two are kept apart all the way down: what LeetCode knows about a problem and
what NeetCode knows are separate records, never merged. Four attempts on LeetCode says
nothing about how it went on NeetCode.

## Two tracks

The extension keeps **two independent review schedules**, and a selector at the top of the
side panel switches the whole UI between them:

| | LeetCode track | NeetCode track |
|---|---|---|
| What's in it | Your full submission history | Your NeetCode work |
| Typical size | Everything you've ever solved | A curriculum of a few hundred |
| Solve dates | Real, from each submission | Real for anything solved in NeetCode's editor; the rest are dateless |
| Default pace | 15 reviews/day, backlog fanned over 30 days | 10 reviews/day, over 14 days |

Daily limits, target retention, backlog seeding and the minimum lock are set per track, so
a gentle NeetCode curriculum can run alongside a much larger LeetCode backlog without
either one setting the pace for the other. The toolbar badge follows whichever track is
selected.

A problem you've done on both sites gets a card in **each** track, scheduled separately —
grading it in one leaves the other where it was. That's the point of the split, but it does
mean working both tracks will show you some problems twice, on different days. If you only
want one, just stay on that track; the other costs nothing but the sync.

### Minimum lock

FSRS thinks in flashcards, where seeing a card again ten minutes later is useful. A coding
problem is not a flashcard: re-solving one six minutes after the last attempt measures
short-term memory of the answer you just wrote and nothing else — which is what rating
something Hard used to do.

Settings carries a floor per difficulty, 4/2/1 days by default and 0 to switch it off. It
applies after FSRS has had its say, so only intervals shorter than the floor move; a mature
card is untouched.

### Seeding only applies to dateless problems

A card built from a real LeetCode submission is already scheduled from when you actually
solved the problem, which is the best information the system has, so the seeding strategy
leaves it alone. Only problems with no recorded date get
redistributed: LeetCode's accepted-set backfill, and any NeetCode problem you ticked
manually or solved elsewhere rather than in its editor.

For the same reason, a dateless report can never move a date a submission vouched for.
NeetCode saying "two-sum is done" today does not overwrite the fact that you solved it a
year ago; when a real date arrives it replaces the guess, whichever order the two syncs
happen in.

### Where problems open

Clicking a problem in the review queue opens it on **NeetCode** by default, since that's
where the video walkthrough and editorial are. NeetCode serves most problems under its own
renamed slugs — `two-sum` lives at `/problems/two-integer-sum` — so
`packages/catalog/data/neetcode-slugs.json` maps between them, generated by
`pnpm neetcode:map` from NeetCode's sitemap and its published rename table.

NeetCode has problem pages for roughly 590 of LeetCode's 4,000-odd problems. Anything it
doesn't host falls back to LeetCode, and the tooltip says which site you're headed to.
Settings has a toggle if you'd rather always open LeetCode.

### Scheduling an imported backlog

Seeding a dateless card as "solved just now" puts it in FSRS's learning state, due in about
ten minutes — so the queue looks empty and then dumps everything at once. Two strategies,
per track, in Settings:

- **Spread** (default) — fans the backlog across a window, hardest problems first, so a
  steady few come due each day.
- **Everything now** — the whole backlog is due immediately, paced by the daily limit.

**Apply to the … track** re-runs this over anything you haven't graded yet, in that track
only; problems with review history are never touched, and neither is the other track.

`packages/importers` holds a developer CLI (`pnpm import:neetcode`) that reads solve dates
out of a NeetCode GitHub Sync repository. It is not part of the extension, which requests
no GitHub permission and makes no GitHub request. It also still keys problems by NeetCode's
own slugs, so its output would import duplicates until it is rewired to use the slug map
that `pnpm neetcode:map` now generates.

### Browsing the schedule

The queue shows what is due today and stops there. **Browse all** opens a full page listing
every problem in the track, soonest first, with a live countdown to each unlock, a filter
for available versus locked, and a title search.

## What went wrong building the NeetCode adapter

Worth reading before changing it, and worth reading before writing the next adapter. The
short version: **the API was the part that went right.** A throwaway probe run in the page
console predicted the response shapes, the `problemId` slug field, and 71-of-77 coverage,
and when the adapter finally worked the data matched exactly. Every failure was in the
environment the adapter runs in, which the probe never touched.

| Symptom | Actual cause | Fix |
|---|---|---|
| Every submission dropped as "unmapped slug" | A content script can't `fetch` an extension asset. The slug map silently came back empty. | Background passes the map over messaging. Declaring `catalog/*` web-accessible would also work, and would hand the whole catalogue to any page on the origin. |
| An empty `firebaseLocalStorageDb` appearing on neetcode.io | `indexedDB.open` *creates* the database when absent, and at `document_start` it usually was. | Check existence first. Better: don't touch Firebase's storage at all. |
| `HTTP 401` on every call | The ID token in Firebase's storage expires hourly, so the stored copy is stale far more often than fresh. The probe only worked because the page had just refreshed it. | Relay the `Authorization` header off a request the page has already made successfully. |
| "Not signed in" on a page that plainly was | The observer captured request *headers* on `fetch` only. Angular's HttpClient uses XHR, so the token went past unseen. | Wrap `setRequestHeader`. An XHR exposes no way to read headers back afterwards. |
| Every problem dated today, after a sync that reported success | The completed-set read and the history walk share one provider cursor, and the former had been setting it for weeks. The walk inherited a recent timestamp on its first run, went incremental, fetched one day, and declared the history done. | A settings migration clears the cursor, buying one full pass. |

Two things are worth generalising.

**Probe the environment, not just the API.** The probe ran in the page console: MAIN world,
the page's own `fetch`, a token seconds old. The adapter runs in an isolated world with
different asset rules, different interception needs, and a token of unknown age. Every
failure lived in that gap, and the probe's success made all of it feel settled.

**Log at `info`, not `debug`.** Chrome files `debug` under Verbose and hides it by default,
so a sync that ran, one that failed, and one never attempted all looked identical from the
console — nothing at all. This cost more time than any individual bug on the list. A
declined sync now reports *why* rather than returning a bare null, for the same reason.

Note that the LeetCode adapter has never been through any of this. It works, but it was
written the same way — from a reading of endpoints, with the environment assumed.

## Terms and limitations

Read on 17 August 2026. Not legal advice — recorded so the position is known rather than
assumed, and so the next person doesn't have to rediscover it.

### LeetCode

Their [Terms](https://leetcode.com/terms/) prohibit automated access in broad language:

> Activities such as "crawling," "scraping," or "spidering" any part of the Service … are
> strictly forbidden.

There is no exception for reading your own data. LeetSpacer walks `/api/submissions/`
programmatically, which a broad reading covers. The argument against is that this is one
user reading their own account from their own signed-in browser at roughly the rate a
person browsing would generate — but the clause does not say that, so it is a grey area
entered knowingly rather than a settled one.

Two adjacent restrictions are satisfied deliberately, and should stay satisfied:

- *"any process that operates while you are not logged into the platform"* — the sync only
  runs inside a signed-in tab, never in the background worker.
- *"placing an undue load on its infrastructure"* — every request goes through
  `createThrottle` at roughly one per second with jitter, and the history walk is capped.

Loosening either of those turns an arguable position into an indefensible one.

### NeetCode

Their [Terms](https://neetcode.io/terms) contain no anti-scraping or anti-automation
clause, which makes the activity walk materially safer than its LeetCode counterpart. One
clause does touch what is shipped here:

> You shall not distribute, publish, transmit, modify, display or create derivative works
> from material obtained with this service.

`packages/catalog/data/neetcode-slugs.json` maps LeetCode slugs to NeetCode's, and is
derived from their `sitemap.xml` — a file published for machines to read, with a
`robots.txt` that disallows nothing — plus a 73-entry rename table taken from their app
bundle. 514 of its 588 entries are identity mappings.

Read plainly this is a contract term rather than a copyright one, and the distinction
matters. The file is factual data with no creative selection or arrangement, which is thin
ground for a copyright claim and therefore for any takedown mechanism that depends on one.
The realistic remedy for a terms breach is that NeetCode asks, and the map is removed or
swapped for LeetCode links. Worth knowing, not worth losing sleep over.

Building the map inside the extension instead was considered and rejected on measurement:
the rename table sits in chunk 84 of 152 content-hashed bundles, and the hashes change on
every deploy, so there is nothing to cache. Finding it costs about 6 MB per run and up to
13 MB if it moves. Doing that on every install would put orders of magnitude more load on
NeetCode than shipping a 32 KB file — worse for them by the measure they would actually
care about.

Asking NeetCode is a five-minute email that settles it permanently, and the pitch is
favourable: the map makes their site the default destination for every problem link in the
extension.

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | Domain model, event folding, `Store` interface. Pure TypeScript — no browser APIs, no framework. |
| `packages/store` | IndexedDB implementation of `Store`, and the schema migrations — per-track cards, then per-provider problem state. |
| `packages/catalog` | The bundled problem dataset (4,028 problems), the NeetCode roadmap DAG, and the LeetCode→NeetCode slug map. |
| `packages/providers` | Site adapters for both sites: response parsing and sync orchestration, with the transport injected so both are testable in Node. |
| `apps/extension` | WXT + React: background worker, side panel, popup, options, content scripts. |

The important boundary: `@lcs/core` knows nothing about browsers or websites, so the
scheduler and recommender are testable in Node and reusable verbatim if a web dashboard
is ever added. `@lcs/providers` knows about websites but not about browsers — both
adapters take their transport as an argument, which is why their full and incremental syncs
have real tests rather than mocked ones. Persistence goes through one interface, which is the entire cost of
adding sync later.

The internal package scope is still `@lcs/*`, from the project's old name. It's invisible
to users and renaming it would touch every import, so it stayed.

## Develop

```sh
pnpm install
pnpm dev            # runs the extension in a dev browser with HMR
pnpm test           # 239 tests across core, store, catalog, providers, importers
pnpm typecheck
pnpm build          # production build -> apps/extension/.output/chrome-mv3
pnpm catalog:build  # regenerate the problem dataset from LeetCode's public API
pnpm neetcode:map   # regenerate the LeetCode -> NeetCode slug map
```

To load it manually: `pnpm build`, then Chrome → Extensions → Developer mode → **Load
unpacked** → `apps/extension/.output/chrome-mv3`.

Node 20+ required. The two data build steps are developer steps — both datasets ship
bundled so the extension never generates traffic just to learn which problems exist.

## Data and permissions

- Permissions requested: `storage`, `sidePanel`, `alarms`, and host access to
  `leetcode.com` and `neetcode.io`. No `tabs`, no `<all_urls>`, no remote code.
- All reads happen from a content script on the site's own origin, using the session
  you're already signed in with. The extension never handles a credential, never makes a
  cross-origin request, and never transmits anything off your machine. LeetCode's session
  cookie is HttpOnly, so it is not readable even in principle; the `csrftoken` cookie is
  echoed back on user-scoped queries exactly as LeetCode's own front end does.
- Requests are throttled (roughly one per second, with jitter) and prefer incremental
  sync. A full history walk is capped and reports when it stops early.
- Company-tag data is community-sourced and used as a weighting hint, never a hard
  filter — LeetCode gates real company tags behind Premium.
