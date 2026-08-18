# Changelog

What changed in each released version of LeetSpacer.

## 1.0.0 — 18 August 2026

First public release.

Privacy policy revision 1, effective 18 August 2026. Nothing to re-accept: this is the
first one.

### Scheduling

- FSRS scheduling, the algorithm behind modern Anki, with a tunable retention target per
  track.
- A daily review queue, most-overdue first, capped so a backlog can't bury you.
- Backlog spreading, so importing years of history doesn't land 400 reviews on day one.
  Only problems with no real solve date are spread — a genuine date is better information
  than anything redistribution could invent.
- A minimum lock per difficulty, so a learning-step interval can't schedule a problem back
  inside the same session. Re-solving a problem six minutes later measures nothing.
- Grade a problem after solving it rather than from memory: the verdict arrives from the
  page.

### Sources

- LeetCode: submission history read from your signed-in session, with real timestamps,
  verdicts and attempt counts. Verified against a live account on 17 August 2026.
- NeetCode: completed problems and submission history, so its track schedules from real
  dates the same way LeetCode's does.
- Both sync from a content script on the site's own origin. No account, no API token, no
  button to press.
- Per-provider problem state, so the two sources can't overwrite each other's scheduling.
  The separation runs the whole way down: cards and review logs are addressed by track,
  problem state by provider, every count is scoped to one of them, and settings are
  written one source or one track at a time. Rescheduling a track reads only that site's
  own history — the version that didn't could replace a schedule built from a real
  LeetCode submission date with a seeded guess from NeetCode's dateless record.

### Interface

- Two independent tracks, LeetCode and NeetCode, each with its own schedule and pacing.
  Neither sets the pace for the other.
- Side panel with the day's queue, a progress bar counted from the review log, and a look
  at what's scheduled ahead.
- A browse tab listing every problem with its unlock countdown.
- Problems open on NeetCode by default, where the video walkthrough is, falling back to
  LeetCode for anything NeetCode doesn't host.
- A get-started page, opened once on install.
- Sync failures are classified into something you can act on rather than reported as
  plumbing.

### Privacy

- Nothing is read from either site until the privacy policy is accepted. The gate covers
  every surface and blocks the reading, not just the interface: the collectors that watch
  the page's own requests are not installed until the answer comes back, and the site's
  own username is not asked for or stored before it.
- Turning a source off under Settings → Your history stands its collectors down and
  refuses anything a tab that was already open still sends.
- What the two collectors relay crosses a private channel between LeetSpacer's own
  scripts, so nothing else running on the page can read it or write into it.
- A policy revision that changes what LeetSpacer does with your data stops the extension
  and asks you to accept it. One that only clarifies wording is published as minor and
  doesn't interrupt you.
- Everything stays in IndexedDB on your machine. No server, no analytics, nothing
  transmitted.
- Export and import your data as JSON. An imported file restores your data, never your
  acceptance of the policy — that is a decision, not a setting.
- Reset one site's data on its own, or both together. Clearing the LeetCode track removes
  what LeetCode contributed and leaves NeetCode exactly as it was, and the other way
  round; opening the site again imports its history from scratch.

### Correctness

- A review card is checked before it is stored. A due date that isn't a real timestamp
  used to be accepted and then skipped by IndexedDB's index — invisible to the queue, the
  badge and the browse list, while seeding kept re-creating it on every sync. Any card
  already in that state is given a due date on upgrade, keeping its review history.
- Importing a file applies all of it or none of it, and every record in it is checked
  first, with the failure naming the list, the position and the field. A backup made
  before some scheduling fields existed still imports; a card with no due date is refused
  rather than given an invented one.
- A schema upgrade can no longer deadlock the extension. Each context closes its
  connection when another needs to upgrade, and any page left holding the old one offers
  to reload instead of hanging silently.
- "Load 10 more" asks for ten more. It used to double the batch each press and rewrite the
  daily-limit setting the panel was displaying.
- The popup and the provider cards no longer claim "not connected" while a tab is open and
  syncing — that state now outlives the service worker being evicted, as does the reason a
  sync failed. A source switched off says so, rather than telling you to open a tab.
- A profile that is out of storage says so, instead of being reported as a network problem
  you should retry.
- The status the panels poll is counted through indexes rather than by loading every card
  and problem in the account several times a second.
- A render failure shows an explanation and a reload instead of a blank surface; the
  options page says so rather than sitting on "Loading…" for ever; the badge reads "99+"
  past ninety-nine; and a card due tonight is described as due later today, not tomorrow.
- LeetCode timestamps are bounded at both ends, so a switch to milliseconds on their side
  would drop the rows rather than schedule everything for the year 51,000.

### Development

- `pnpm zip` runs typecheck and tests before packaging, and `PRIVACY.md` is checksummed
  against its declared revision — the policy cannot be changed and shipped without users
  being asked to accept it.
- CI runs typecheck, tests and a production build on every push and pull request, with
  read-only permissions and every action pinned to a commit.
