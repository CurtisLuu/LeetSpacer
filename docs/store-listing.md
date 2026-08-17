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
• Problems open on NeetCode by default, where the video walkthrough is, and fall back to
  LeetCode for anything NeetCode doesn't host
• Export and import your data as JSON

PRIVACY

Everything stays on your device. There is no server, no account, and no analytics.
LeetSpacer reads your history from a script running on leetcode.com and neetcode.io using
the session you're already signed in with — it never handles a password or a token, and
nothing is ever transmitted anywhere.

Full policy: https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md
Source code: https://github.com/CurtisLuu/LeetSpacer
```

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
| `storage` | Stores the user's review schedule, per-problem scheduling state and settings locally in the browser. This is the extension's entire dataset; there is no server. |
| `sidePanel` | The review queue is presented in Chrome's side panel, which is the extension's primary interface. |
| `alarms` | Periodically recomputes how many reviews are due so the toolbar badge stays accurate without polling. |
| Host: `leetcode.com` | A content script on leetcode.com reads the signed-in user's own submission history (problem slugs, timestamps, verdicts) to schedule reviews from real solve dates. Reading it from that origin is what lets the user's existing session apply without the extension ever handling a credential. |
| Host: `neetcode.io` | A content script on neetcode.io reads the signed-in user's own set of completed problems, which the page has already fetched and cached in localStorage. The extension issues no request of its own here. |
| Host: `api.github.com` (optional) | Requested only if the user explicitly connects a NeetCode GitHub Sync repository, to read commit dates as a source of real solve dates. Never requested at install. |
| Remote code | Not used. All code is bundled in the package; nothing is fetched or evaluated at runtime. |

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
pnpm typecheck && pnpm test   # sanity check
pnpm zip
```

The artifact lands at `apps/extension/.output/leetspacer-1.0.0-chrome.zip`. Upload that
file, not the unpacked folder.

Bump `version` in `apps/extension/package.json` for every resubmission — the store rejects
a duplicate version number. The manifest has no version of its own; WXT reads that one, so
there is nothing to keep in sync.

Icons regenerate with `pnpm --filter @lcs/extension icons` if the mark ever changes. They
are committed, so a normal build needs no Python.

---

## What review will probably ask about

Two host permissions on sites with user accounts is the part a reviewer looks at. The
answers, if they write:

- **Why do you need to read the user's history?** It is the entire product. A spaced
  repetition scheduler with no history has nothing to schedule.
- **Are you scraping or automating a third-party site?** No. Requests run from the user's
  own session, on the site's own origin, throttled to roughly one per second, and only to
  read that user's own data. The NeetCode path issues no requests at all.
- **Where does the data go?** Nowhere. IndexedDB on the user's machine.
