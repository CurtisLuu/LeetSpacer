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

## Notes for anyone touching the NeetCode adapter

It took several wrong turns to get working, and every one of them failed silently. Worth
knowing before changing it:

- **A content script cannot fetch an extension asset.** The slug map has to come from the
  background over messaging. Declaring `catalog/*` web-accessible would work and would also
  hand the whole catalogue to any page on the origin.
- **Do not read the auth token from Firebase's IndexedDB.** The stored copy expires hourly,
  so it is stale far more often than not — that produced an HTTP 401 on every sync. Opening
  that database also *creates* it when absent, which is not ours to do on someone else's
  origin. The token is relayed off the page's own requests instead.
- **NeetCode uses XHR, not `fetch`.** Angular's HttpClient does. An observer that only
  wraps `fetch` sees nothing, so `setRequestHeader` has to be wrapped to catch the header.
- **The completed-set read and the history walk share a sync cursor.** The former had been
  setting it for weeks, so the walk inherited a recent timestamp on its first run and went
  incremental, fetching one day and declaring the history done.

The general lesson: log at `info`, not `debug`. Chrome files `debug` under Verbose and
hides it, so a sync that ran, one that failed, and one never attempted all looked
identical from the console — nothing at all.

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
