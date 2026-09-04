# Chrome Web Store submission

Everything the dashboard asks for, written out so submission is copy-and-paste rather
than improvisation at the form. Nothing here is uploaded automatically — publishing needs
your developer account.

---

## Before you submit

The LeetCode history sync was confirmed working against a live signed-in account on
2026-08-17, which was the one thing that had to be checked by hand. Two narrower paths
still haven't been exercised — see the table in [`providers.md`](providers.md). Neither
blocks a release: each degrades to "that feature is quiet" rather than to broken data.

- **The accepted-set backfill** (`phase: "solved-set-unavailable"` in the console if it
  fails). Without it, problems older than your submission history's reach never get a card.
- **The live verdict relay.** Submit a problem with the side panel open and watch for
  `[lcs] <slug>: accepted`. Without it, the verdict just arrives on the next sync instead.

Worth confirming, if you haven't already, that your existing NeetCode schedule survived the
v1→v2 database migration intact — it should have been moved, not rebuilt.

The remaining blocker is screenshots, below. Those need a real install with real data, so
only you can take them.

Re-run `pnpm zip` after any code change — the artifact in `.output/` is whatever was built
last, and uploading a stale one is the easiest mistake here to make.

---

## Listing fields

**Name**

```
LeetSpacer
```

**Short description** (132 char limit; this is 127)

```
Spaced repetition for coding interview prep. Schedules reviews from your own LeetCode and NeetCode history, all stored locally.
```

**Category**: Productivity
**Language**: English (United States)

**Detailed description**

```
LeetSpacer tells you which coding problems to review today, based on when you actually
solved them.

Cramming the same 150 problems before an interview does not work. Spaced repetition does:
you review a problem just before you would have forgotten it, and the interval grows each
time you get it right. LeetSpacer applies that to interview prep, using the practice
history you already have.

HOW IT WORKS

Open leetcode.com while signed in and your submission history syncs automatically — with
real timestamps and verdicts, so reviews are scheduled from when you actually solved
something, and problems that took you five attempts are treated as harder than ones you
got first try.

Open neetcode.io/practice and your completed problems sync the same way.

There is no button to press, no account to create, and no API token to paste.

TWO INDEPENDENT TRACKS

A selector switches the whole panel between a LeetCode track and a NeetCode track, each
with its own schedule and its own pacing. Work a focused NeetCode curriculum at five
reviews a day while your full LeetCode backlog ticks along separately — neither one sets
the pace for the other.

WHAT YOU GET

• A daily queue of problems due for review, most-overdue first
• FSRS scheduling — the algorithm behind modern Anki — with a tunable retention target
• Real solve dates and attempt counts from your LeetCode history
• Backlog spreading, so importing years of history doesn't dump 400 reviews on day one
• Problems open on the site whose track you're reviewing — NeetCode problems on NeetCode,
  where the video walkthrough is, LeetCode problems on LeetCode
• Export and import your data as JSON

PRIVACY

Everything stays on your device. There is no server, no account, and no analytics.
LeetSpacer reads your history from a script running on leetcode.com and neetcode.io using
the session you're already signed in with, and nothing is ever transmitted anywhere. It
never handles a password. Reading your NeetCode history needs the short-lived token
neetcode.io itself uses, which is borrowed from a request the page has already made, kept
in memory for that tab only, and never stored — LeetCode needs nothing at all, because
your browser attaches its cookie by itself.

Nothing is read until you accept the privacy policy, which the extension shows you the
first time it runs.

LeetSpacer is an independent project. It is not affiliated with, endorsed by, or connected
to LeetCode or NeetCode.

Full policy: https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md
Source code: https://github.com/CurtisLuu/LeetSpacer
```

**What's new** — there is no field for this. The dashboard has no release-notes box, and
the listing shows only a version number and an "Updated" date; a visitor cannot see what
changed between two versions anywhere on the store. The convention is to paste a short
block at the *top* of the detailed description above and rewrite it each release.

Paste the current block at the top of the detailed description above. Each release, put
the headline items from that version's [`CHANGELOG.md`](../CHANGELOG.md) entry here, three
or four lines at most, and move the previous one out. Nothing was written for 1.0.0 —
everything was new.

```
WHAT'S NEW IN 1.0.3

• Works in Arc — the toolbar icon opens a small popup window there instead of doing nothing
• Fixed "Load more" pulling in far more cards than one batch's worth

Full history: https://github.com/CurtisLuu/LeetSpacer/blob/main/CHANGELOG.md
```

If a release changes the privacy policy, say so in this block. It is the only place a
prospective user sees it before installing.

---

## Privacy tab

**Single purpose**

```
Scheduling spaced-repetition reviews of coding-interview problems the user has already
solved, using their own practice history from LeetCode and NeetCode.
```

**Permission justifications** — paste each verbatim into its box.

| Field | Justification |
|---|---|
| `sidePanel` | The review queue is presented in Chrome's side panel, which is the extension's primary interface. |
| `alarms` | Periodically recomputes how many reviews are due so the toolbar badge stays accurate without polling. |
| Host: `leetcode.com` | A content script on leetcode.com reads the signed-in user's own submission history (problem slugs, timestamps, verdicts) to schedule reviews from real solve dates. Reading it from that origin is what lets the user's existing session apply without the extension ever handling a credential. |
| Host: `neetcode.io` | A content script on neetcode.io reads the signed-in user's own progress. The set of completed problems is read from a copy the page has already fetched and cached in localStorage, at no request cost. Per-submission dates come from neetcode.io's own activity endpoint, called from that origin, one throttled request per day the user was active. Those calls need the short-lived bearer token neetcode.io uses for itself: it is observed on a request the page has already made, held in memory for the life of the tab, and never stored, exported or sent anywhere else. |
| Remote code | Not used. All code is bundled in the package; nothing is fetched or evaluated at runtime. |

No `storage` permission is requested. Every byte the extension keeps is in IndexedDB,
which needs none.

**Data usage disclosures** — the dashboard requires you to tick what you collect. The
honest answers:

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

"Collect" in the store's definition means transmitting off the user's machine. LeetSpacer
transmits nothing, so every box is No. It does *read* practice history, which is disclosed
in the privacy policy and the listing.

Then tick all three certifications: no selling to third parties, no use outside the single
purpose, no use for creditworthiness or lending.

**Consent**

The extension reads nothing from either site until the privacy policy is accepted on the
welcome page it opens at install. That gate covers the content scripts, not just the
interface — before acceptance, no page is read, no request is made, and nothing is written
to storage. Concretely: each content script sends one greeting to the background worker
and waits; the MAIN-world collector that watches the site's own requests is not installed
until that answer says the policy was accepted, and the LeetCode username is neither asked
for nor stored before it. Worth mentioning in the review notes, since it is the question
the host permissions invite.

**Privacy policy URL**

```
https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md
```

---

## Graphics you still need to make

The store will not accept a listing without at least one screenshot, and these have to
come from a real install with real data.

| Asset | Size | Required | Suggested shot |
|---|---|---|---|
| Screenshot 1 | 1280×800 | **Yes** | Side panel, LeetCode track, a few problems due with difficulty and topic chips visible |
| Screenshot 2 | 1280×800 | No | The track selector mid-switch, showing both counts |
| Screenshot 3 | 1280×800 | No | Settings, showing the two per-track schedule blocks |
| Small promo tile | 440×280 | No | Icon plus the tagline; needed to be featured |
| Marquee promo tile | 1400×560 | No | Only for front-page featuring |

Take them at 1280×800 exactly — Chrome resizes anything else and it looks soft. Blur or
swap your username if it appears.

---

## Packaging

```sh
pnpm zip
```

`zip` runs `typecheck` and the tests first and stops on a failure, so there is no separate
sanity check to remember. One of those tests pins `PRIVACY.md` to its declared revision —
if you edited the policy, the build stops with the exact entry to append to
`PRIVACY_REVISIONS`. See **Changing the privacy policy** below.

The artifact lands at `apps/extension/.output/leetspacer-<version>-chrome.zip` — the
version is read from `apps/extension/package.json`, so the filename tells you which build
you are holding. Upload that file, not the unpacked folder.

Bump `version` in `apps/extension/package.json` for every resubmission — the store rejects
a duplicate version number. The manifest has no version of its own; WXT reads that one, so
there is nothing to keep in sync.

Add the matching [`CHANGELOG.md`](../CHANGELOG.md) entry in the same commit as the bump,
and refresh the WHAT'S NEW block above. Both are hand-maintained; nothing about the upload
generates them.

Icons regenerate with `pnpm --filter @lcs/extension icons` if the mark ever changes. They
are committed, so a normal build needs no Python.

Note that 48 and 128 render the mark faithfully — pale face, purple deck behind — while 16
and 32 invert to a filled accent card with light braces. The pale face is invisible against
a white browser toolbar, and by 16px the braces are thinner than a pixel. The store listing
uses the 128, so what a reviewer sees is the real artwork.

---

## Changing the privacy policy

`PRIVACY.md` is pinned by checksum to an entry in `PRIVACY_REVISIONS`
(`packages/core/src/settings.ts`). Edit the policy and `pnpm zip` fails until a revision is
declared, so this cannot be forgotten on the way to a submission — which matters, because
the policy promises a revision is presented to the user before the extension carries on
reading, and nothing else would notice a broken promise.

1. Edit `PRIVACY.md` and move its **Effective** date.
2. Run `pnpm test`. It fails and prints the entry to append, checksum included.
3. Append it. Set `carriesForward: true` **only** if the revision changes nothing about
   what LeetSpacer does with someone's data — wording, formatting, clarification. Leave it
   off and every user re-accepts, which is the right way to be wrong. This is our call per
   revision; there is no user-facing setting that waives it.
4. Bump `apps/extension/package.json`, add the `CHANGELOG.md` entry, refresh WHAT'S NEW.
5. `pnpm zip` and submit.

Users land on the new build through Chrome's normal auto-update, within hours. On next
open the consent gate returns and reading is already halted — `background.ts` refuses the
sync claim and drops any events that arrive anyway. Stored schedules and history are
untouched; the gate covers the interface, it does not clear anything.

---

## What review will probably ask about

Two host permissions on sites with user accounts is the part a reviewer looks at. The
answers, if they write:

- **Why do you need to read the user's history?** It is the entire product. A spaced
  repetition scheduler with no history has nothing to schedule.
- **Are you scraping or automating a third-party site?** No. Requests run from the user's
  own session, on the site's own origin, throttled to roughly one per second, and only to
  read that user's own data. On NeetCode the completed-problem set costs no request at all
  — it is read from what the page has already cached — and the submission-history walk is
  one request per day the user was active, capped at 600.
- **Does the extension handle a credential?** On LeetCode, no: the session cookie is
  HttpOnly and the browser attaches it. On NeetCode, yes and only there — the site
  authenticates with a bearer token rather than a cookie, so the history walk reuses the
  one the page itself just used. It is never read out of storage, never persisted, never
  exported, and never sent anywhere but back to neetcode.io. `PRIVACY.md` § Credentials
  says the same thing to the user.
- **What runs before consent?** Nothing that reads. Both content scripts greet the
  background worker and stop there until the policy is accepted; the collectors that watch
  each site's own requests are not installed until the answer comes back.
- **Where does the data go?** Nowhere. IndexedDB on the user's machine.
