# Privacy Policy — LeetSpacer

**Last updated: 17 August 2026**

LeetSpacer is a Chrome extension that schedules review sessions over your own coding
practice history.

## Consent

LeetSpacer reads nothing until you accept this policy. The prompt appears on the welcome
page the first time the extension runs, and until you accept it no page is read, no request
is made, and nothing is written to storage.

## The short version

LeetSpacer does not collect, transmit, sell, or share any of your data. There is no
server, no account, and no analytics. Everything it reads stays in your browser on your
own device.

## What it reads

LeetSpacer reads two things, and only while you have the relevant site open:

**From leetcode.com** — your submission history: problem names, submission timestamps,
verdicts (Accepted, Wrong Answer, and so on), and your LeetCode username. This is read
from the same endpoints leetcode.com's own pages use, from a script running on
leetcode.com, using the session you are already signed in with.

**From neetcode.io** — the set of problems you have marked complete, plus your submission
history: problem names, submission timestamps and verdicts. The completed set is read from
the copy NeetCode's own page has already cached in local storage. The submission history is
read from the same endpoints NeetCode's activity page uses, from a script running on
neetcode.io.

It does not read your solution code, your email address, your payment details, your
browsing on any other site, or anything on a page you are not signed in to.

## Where it goes

Nowhere. All of it is stored in IndexedDB inside your browser profile, on your machine.
LeetSpacer has no backend and makes no request to any server operated by its author.

The only network requests LeetSpacer makes are to `leetcode.com` itself, from within a
leetcode.com tab, for the history described above. The problem catalogue it uses for
titles and difficulty is bundled inside the extension, so it does not phone home to learn
what problems exist.

## Credentials

LeetSpacer never sees or stores a password, and transmits nothing anywhere.

**LeetCode.** Requests run on leetcode.com and your browser attaches your existing cookie
automatically — the same way a normal page load does. LeetCode's session cookie is marked
`HttpOnly`, so it is not readable by extension code even in principle.

**NeetCode.** NeetCode authenticates with a short-lived bearer token rather than a cookie.
Reading your submission history is not possible without one, so LeetSpacer reuses the
token from a request neetcode.io has already made itself — it is observed in passing, not
extracted from storage. It is held in memory for the life of the tab, used only for
requests back to neetcode.io, never written to LeetSpacer's storage, never included in an
export, and never sent anywhere else.

If you would rather it did not, turn NeetCode off under Settings → Your history. The
extension then reads nothing from the site at all.

## Your control over it

- **Export** — Settings → Export JSON writes your entire local dataset to a file.
- **Delete** — Settings → Reset all data erases every tracked problem, review card and
  grade from your browser. Uninstalling the extension also removes its storage.
- **Turn a source off** — Settings → Your history has a *Sync this source* switch for
  LeetCode and for NeetCode independently.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | Keeps your review schedule and settings in the browser. |
| `sidePanel` | The review queue is a side panel. |
| `alarms` | Wakes the extension periodically to refresh the due-count badge. |
| Access to `leetcode.com` | Read your submission history from a script on that origin. |
| Access to `neetcode.io` | Read your completed-problem set from that page's own cache. |

LeetSpacer requests no `tabs` permission, no `<all_urls>`, and executes no remotely hosted
code.

## Children

LeetSpacer is a developer tool and is not directed at children under 13.

## Changes

Material changes to this policy will be published in this file, and the "last updated"
date above will change. The file's full history is public in the repository.

## Contact

Questions or concerns: open an issue at
<https://github.com/CurtisLuu/LeetSpacer/issues>.
