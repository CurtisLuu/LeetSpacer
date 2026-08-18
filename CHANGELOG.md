# Changelog

What changed in each released version of LeetSpacer.

## 1.0.0 — unreleased

First public release. Set the date here when it ships.

Privacy policy revision 1, effective 17 August 2026. Nothing to re-accept: this is the
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
  every surface and blocks the reading, not just the interface.
- A policy revision that changes what LeetSpacer does with your data stops the extension
  and asks you to accept it. One that only clarifies wording is published as minor and
  doesn't interrupt you.
- Everything stays in IndexedDB on your machine. No server, no analytics, nothing
  transmitted.
- Export and import your data as JSON.

### Development

- `pnpm zip` runs typecheck and tests before packaging, and `PRIVACY.md` is checksummed
  against its declared revision — the policy cannot be changed and shipped without users
  being asked to accept it.
- CI runs typecheck and tests on every push and pull request.
