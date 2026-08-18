# Privacy Policy — LeetSpacer

**Effective 18 August 2026.** This is the current version; earlier ones are in this
repository's history.

LeetSpacer is a free, open-source Chrome extension maintained by an individual developer.
The source is at <https://github.com/CurtisLuu/LeetSpacer> and can be read in full,
including every line described below.

## Your acceptance

LeetSpacer reads nothing until you accept this policy. When the extension first runs it
shows this policy and asks you to accept it; **clicking "Accept and continue" means you
agree to it.** Until you do, no page is read, no request is made, and nothing is written to
storage.

If you do not agree, do not accept — uninstall the extension and nothing of yours will have
been touched.

**If this policy changes in a way that affects what LeetSpacer does with your data, the
extension stops and asks you to accept the new version before it reads anything else.** It
does not wait for you to notice, and it does not carry your previous acceptance over.
That always includes a revision that:

- reads something new, reads it from somewhere new, or sends anything off your device;
- reduces your control over what is already stored; or
- changes who publishes or controls LeetSpacer.

A revision that changes none of those — a clarification, a correction, a rewording — is
published as a minor one and does not interrupt you. The effective date above still
changes, and it is still listed in [`CHANGELOG.md`](CHANGELOG.md).

Which of the two a revision is, is recorded in the source alongside the date it took
effect, and this file is checksummed against that record: it cannot be edited without a
revision being declared, and the build fails if anyone tries. The list is
`PRIVACY_REVISIONS` in `packages/core/src/settings.ts`.

You can withdraw consent at any time by uninstalling the extension, which deletes
everything it holds. See **Your control over your data** below for narrower options.

## The short version

LeetSpacer does not collect, transmit, sell, or share any of your data. There is no server,
no account, and no analytics. Everything it reads stays in your browser on your own device.
The developer never receives your data and has no way to.

## What LeetSpacer reads

Only while you have the relevant site open, and only your own signed-in data:

**From leetcode.com** — your submission history: the problem each submission was for, when
it was submitted, and whether it passed. Also your LeetCode username, and the list of
problems you have solved. This is read from the same endpoints leetcode.com's own pages
use, by a script running on leetcode.com, using the session you are already signed in with.

**From neetcode.io** — the set of problems you have marked complete, and your submission
history: the problem, the time, and the result. The completed set is read from a copy
NeetCode's own page has already stored in your browser. The submission history is read from
the same endpoints NeetCode's activity page uses.

## What LeetSpacer does not read

- **Your solution code.** LeetCode's submission history response happens to include the
  source you submitted. LeetSpacer extracts only the problem, the timestamp, and the
  result, and never reads, stores, or transmits the code itself.
- Your email address, real name, password, or payment details.
- Any page you are not signed in to, and any site other than the two above.
- Your browsing activity anywhere else. LeetSpacer has no ability to see it — it requests
  no `tabs` permission and no access to other sites.

## Where your data is stored

In IndexedDB inside your own browser profile, on your own machine. LeetSpacer has no
backend and makes no request to any server operated by its developer, because there is no
such server.

The only network requests LeetSpacer makes are to `leetcode.com` and `neetcode.io`, from
within a tab already open on those sites, for the data described above. The problem
catalogue used for titles and difficulty ships inside the extension, so it does not need to
contact anything to work.

## How long it is kept, and how to delete it

Your data stays until you remove it. There is no expiry and no background deletion.

- **Settings → Reset the LeetCode track** or **Reset the NeetCode track** erases what that
  one site contributed — its problems, its review cards and their grades, and the record of
  your username there — and leaves the other site's data untouched.
- **Settings → Reset all data** erases every tracked problem, review card and grade, from
  both sites.
- **Uninstalling the extension** deletes everything, including settings. Chrome removes an
  extension's storage when it is removed.
- **Settings → Export JSON** writes your entire dataset to a file first, if you want a copy.

## Your control over your data

- **Turn a source off.** Settings → Your history has an independent switch for LeetCode and
  for NeetCode. Turning one off stops it being read; anything already collected stays until
  you delete it.
- **Delete one site's data.** The two sites are kept separate all the way down, so either
  can be erased on its own without touching the other. See the resets above.
- **Export** and **reset**, as above.
- **Read the code.** Every claim here is verifiable in the repository.

## Credentials

LeetSpacer never sees or stores a password, and transmits nothing anywhere.

**LeetCode** authenticates with a cookie your browser attaches automatically to requests
made from leetcode.com, the same way it does for a normal page load. LeetCode's session
cookie is marked `HttpOnly`, so extension code cannot read it even in principle.

**NeetCode** authenticates with a short-lived bearer token rather than a cookie, and reading
your history is not possible without one. LeetSpacer reuses the token from a request
neetcode.io has already made itself — it is observed in passing, not extracted from storage.
It is held in memory only for as long as that tab is open, used only for requests back to
neetcode.io, never written to storage, never included in an export, and never sent anywhere
else. It is passed between LeetSpacer's own two scripts over a private channel that the
page cannot read, so observing it does not expose it to neetcode.io or anything running
there. If you would rather it did not, turn NeetCode off under Settings → Your history.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `sidePanel` | The review queue is a side panel. |
| `alarms` | Wakes the extension periodically to refresh the due-count badge. |
| Access to `leetcode.com` | Read your own history from a script on that origin. |
| Access to `neetcode.io` | Read your own history from a script on that origin. |

Your review schedule and settings are kept in IndexedDB, which needs no permission at all,
so none is requested for it. LeetSpacer requests no `tabs` permission, no `<all_urls>`, and
executes no remotely hosted code. Everything it runs ships inside the extension package.

## Third-party sites

LeetCode and NeetCode are independent services with their own privacy policies and terms,
which govern your relationship with them. LeetSpacer is not affiliated with, endorsed by, or
connected to either. Using LeetSpacer does not change what those sites collect about you,
and this policy does not cover their practices.

## Security

Your data never leaves your device, so there is no server holding it and no transmission to
intercept. It is protected by your browser profile and your computer, and anyone with access
to those has access to it — as they would to your browsing history.

## Children

LeetSpacer is a developer tool and is not directed at children under 13. It does not
knowingly collect anything from anyone, of any age.

## Changes to this policy

Changes will be published here and the effective date above will change. Anything
affecting what LeetSpacer does with your data stops the extension until you accept it, as
described under **Your acceptance**. Every revision, its date and whether it was minor are
listed in [`CHANGELOG.md`](CHANGELOG.md), and the full history of this file is public.

## No warranty

LeetSpacer is provided free and as-is under the MIT License, which is included in this
repository and disclaims warranties and liability. Nothing in this policy adds a warranty.

## Contact

Questions, concerns, or a request about your data: open an issue at
<https://github.com/CurtisLuu/LeetSpacer/issues>.
