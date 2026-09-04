# LeetSpacer

A Chrome extension that reads your own LeetCode and NeetCode progress and tells you what
to review today — spaced repetition scheduled from when you actually solved each problem.
Also works in Arc, which installs it straight from the Chrome Web Store like any other
Chromium browser; Arc has no side panel API, so the toolbar icon opens a small popup window
there instead.

Everything stays on your device. 

---

# For users

## Getting started

1. Install the extension at https://chromewebstore.google.com/detail/leetspacer/cloleogcoanmafocdppkocacljmcalah?authuser=1&hl=en 
2. Open **leetcode.com** or **neetcode.io** while signed in. Your problems will sync from there.
3. Click the LeetSpacer icon whenever the toolbar badge shows a number. Solve what's in
   the queue, then rate how it went — that rating decides when you see it again.

The first LeetCode sync walks your whole history and takes a few minutes. NeetCode takes a
minute or two. Both then settle into a single incremental request, at most one every
fifteen minutes.

## How it collects your history

Both sources read the session you are already signed in with, from a content script on
that site's own origin. Nothing is configured, no token is entered, and nothing leaves
your machine. There is no manual sync button because there is no manual sync — the reading
happens inside a tab on the site, so opening one *is* the sync.

**LeetCode.** The extension walks your submission history from `/api/submissions/` — the
endpoint the site's own submissions page uses — which carries **real per-submission
timestamps and verdicts**. That's what lets reviews be scheduled from when you actually
solved something, and lets attempt counts reflect how much a problem fought back. It then
backfills your complete accepted set for anything the history didn't reach. Submitting
with a LeetCode tab open also records the verdict the moment the judge returns it.

**NeetCode.** Two things are read from [neetcode.io/practice](https://neetcode.io/practice).
The completed-problem set comes free — the page fetches it on load and caches it in
`localStorage`, so the extension reads what is already there. On top of that, the extension
walks NeetCode's own activity history, one request per day you were active, which carries
**per-submission timestamps and verdicts** exactly as LeetCode's does.

That walk needs a bearer token, because NeetCode authenticates with one rather than a
cookie. It is not read out of storage — the copy Firebase keeps there expires hourly and is
usually stale. Instead the token is taken from a request neetcode.io has already made
itself, held in memory for the life of the tab, used only for calls back to neetcode.io,
and never stored or transmitted. It travels between the extension's two scripts over a
private `MessageChannel`, so it is never posted onto a bus the page can listen on. This is
the one place the extension handles a credential at all; if you would rather it did not,
turn NeetCode off under Settings → Your history.

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

The two are kept apart all the way down: what LeetCode knows about a problem and what
NeetCode knows are separate records, never merged. Four attempts on LeetCode says nothing
about how it went on NeetCode.

A problem you've done on both sites gets a card in **each** track, scheduled separately —
grading it in one leaves the other where it was. That's the point of the split, but it does
mean working both tracks will show you some problems twice, on different days. If you only
want one, just stay on that track; the other costs nothing but the sync.

## How the scheduling works

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
leaves it alone. Only problems with no recorded date get redistributed: LeetCode's
accepted-set backfill, and any NeetCode problem you ticked manually or solved elsewhere
rather than in its editor.

For the same reason, a dateless report can never move a date a submission vouched for.
NeetCode saying "two-sum is done" today does not overwrite the fact that you solved it a
year ago; when a real date arrives it replaces the guess, whichever order the two syncs
happen in.

### Scheduling an imported backlog

Seeding a dateless card as "solved just now" puts it in FSRS's learning state, due in about
ten minutes — so the queue looks empty and then dumps everything at once. Two strategies,
per track, in Settings:

- **Spread** (default) — fans the backlog across a window, hardest problems first, so a
  steady few come due each day.
- **Everything now** — the whole backlog is due immediately, paced by the daily limit.

**Apply to the … track** re-runs this over anything you haven't graded yet, in that track
only; problems with review history are never touched, and neither is the other track.

### Browsing the schedule

The queue shows what is due today and stops there. **Browse all** opens a full page listing
every problem in the track, soonest first, with a live countdown to each unlock, a filter
for available versus locked, and a title search.

### Starting over

**Settings → Start over** is per track. Clearing the LeetCode track or the NeetCode track
removes its problems, its cards and their grades, plus its sync cursors so the site
re-imports from scratch — leaving the other one untouched. Or clear both at once.

## Data and permissions

- Permissions requested: `sidePanel`, `alarms`, and host access to `leetcode.com` and
  `neetcode.io`. No `tabs`, no `<all_urls>`, no remote code, and no `storage` — everything
  is kept in IndexedDB, which needs no permission.
- All reads happen from a content script on the site's own origin, using the session
  you're already signed in with. Nothing goes off your machine and no cross-origin request
  is made. On LeetCode no credential is handled at all: the session cookie is HttpOnly, so
  it is not readable even in principle, and the `csrftoken` cookie is echoed back on
  user-scoped queries exactly as LeetCode's own front end does. NeetCode is the one
  exception, described above.
- Nothing is read until the privacy policy is accepted.
- Requests are throttled (roughly one per second, with jitter) and prefer incremental
  sync. A full history walk is capped and reports when it stops early.
- **Backup and restore** in Settings exports everything to JSON and imports it back.
  Importing merges rather than replacing, and review grades survive the round trip.

---

# For developers

## Commands

```sh
pnpm install
pnpm dev            # runs the extension in a dev browser with HMR
pnpm test           # 331 tests across core, store, catalog, providers, importers, extension
pnpm typecheck
pnpm build          # production build -> apps/extension/.output/chrome-mv3
pnpm zip            # typecheck + test + package for the Chrome Web Store
```

Node 22.13+ required, which is pnpm 11's floor.

To load it manually: `pnpm build`, then Chrome → Extensions → Developer mode → **Load
unpacked** → `apps/extension/.output/chrome-mv3`. Chunk filenames are content-hashed, so
after a rebuild you must reload the extension from `chrome://extensions` — refreshing the
page is not enough.

### Data build steps

```sh
pnpm catalog:build  # regenerate the problem dataset from LeetCode's public API
pnpm neetcode:map   # regenerate the LeetCode -> NeetCode slug map
pnpm import:neetcode # developer CLI, not part of the extension (see below)
```

Both datasets ship bundled so the extension never generates traffic just to learn which
problems exist. They are **developer** steps, run by hand and committed — nothing
regenerates them at runtime or on a schedule. `pnpm build` copies whatever is in
`packages/catalog/data/` into the extension's `public/`.

Neither is urgent to re-run. A problem missing from the catalog still schedules and reviews
correctly; it just shows a title derived from its slug and no difficulty. Re-run them when
cutting a release to pick up problems added since the last snapshot. `pnpm catalog:build`
is paginated and rate-limited on purpose and takes a couple of minutes.

The side panel footer reports what shipped — problem count and generation date — read
straight off the bundled file. It is one dataset shared by both tracks, so it reads the
same whichever track is selected: NeetCode problems *are* LeetCode problems, keyed by
LeetCode `titleSlug` throughout.

`packages/importers` holds a developer CLI (`pnpm import:neetcode`) that reads solve dates
out of a NeetCode GitHub Sync repository. It is not part of the extension, which requests
no GitHub permission and makes no GitHub request. It also still keys problems by NeetCode's
own slugs, so its output would import duplicates until it is rewired to use the slug map
that `pnpm neetcode:map` generates.

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | Domain model, event folding, `Store` interface. Pure TypeScript — no browser APIs, no framework. |
| `packages/store` | IndexedDB implementation of `Store`, and the schema migrations — per-track cards, then per-provider problem state, then the indexes each track's counts are read through. |
| `packages/catalog` | The bundled problem dataset (4,033 problems), the NeetCode roadmap DAG, and the LeetCode→NeetCode slug map. |
| `packages/providers` | Site adapters for both sites: response parsing and sync orchestration, with the transport injected so both are testable in Node. |
| `apps/extension` | WXT + React: background worker, side panel, options, welcome page, content scripts. |

The important boundary: `@lcs/core` knows nothing about browsers or websites, so the
scheduler is testable in Node and reusable verbatim if a web dashboard is ever added.
`@lcs/providers` knows about websites but not about browsers — both adapters take their
transport as an argument, which is why their full and incremental syncs have real tests
rather than mocked ones. Persistence goes through one interface, which is the entire cost
of adding sync later.

The internal package scope is still `@lcs/*`, from the project's old name. It's invisible
to users and renaming it would touch every import, so it stayed.

See [`docs/providers.md`](docs/providers.md) for the exact response shapes each adapter
parses.

## How the two sources stay separate

This is closer to two applications sharing a toolbar icon than to one application with a
filter. Problem state is addressed by `(provider, slug)`, cards and review logs by
`(track, slug)`, every count is read through an index scoped to one of them, and settings
are written one source or one track at a time — a write that names both is not a shape the
store offers.

`packages/core/src/separation.test.ts` is the list of what that has to mean: a problem
solved on both sites keeps two records and two schedules, grading it in one track leaves
the other untouched, and rescheduling a track reads only its own provider's history. The
only thing the two share is the slug that names a problem.

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

## Licence

MIT — see [LICENSE](LICENSE). The grant covers this project's source code. The bundled
problem data in `packages/catalog/data/` is derived from LeetCode and NeetCode and belongs
to them.
