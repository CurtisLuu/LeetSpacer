# Privacy Policy — LeetSpacer

**Effective 17 August 2026.** This is the current version; earlier ones are in this
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

If this policy changes materially, the extension will ask you to accept the new version
before continuing. Continuing to use LeetSpacer after accepting a revision means you agree
to that revision.

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

- **Settings → Reset all data** erases every tracked problem, review card and grade.
- **Uninstalling the extension** deletes everything, including settings. Chrome removes an
  extension's storage when it is removed.
- **Settings → Export JSON** writes your entire dataset to a file first, if you want a copy.

## Your control over your data

- **Turn a source off.** Settings → Your history has an independent switch for LeetCode and
  for NeetCode. Turning one off stops it being read; anything already collected stays until
  you delete it.
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
else. If you would rather it did not, turn NeetCode off under Settings → Your history.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | Keeps your review schedule and settings in the browser. |
| `sidePanel` | The review queue is a side panel. |
| `alarms` | Wakes the extension periodically to refresh the due-count badge. |
| Access to `leetcode.com` | Read your own history from a script on that origin. |
| Access to `neetcode.io` | Read your own history from a script on that origin. |

LeetSpacer requests no `tabs` permission, no `<all_urls>`, and executes no remotely hosted
code. Everything it runs ships inside the extension package.

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

Material changes will be published here, the effective date above will change, and the
extension will ask you to accept the new version. The full history of this file is public.

## No warranty

LeetSpacer is provided free and as-is under the MIT License, which is included in this
repository and disclaims warranties and liability. Nothing in this policy adds a warranty.

## Contact

Questions, concerns, or a request about your data: open an issue at
<https://github.com/CurtisLuu/LeetSpacer/issues>.
