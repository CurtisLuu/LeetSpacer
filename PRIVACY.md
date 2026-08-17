# Privacy Policy — LeetSpacer

**Last updated: 17 August 2026**

LeetSpacer is a Chrome extension that schedules review sessions over your own coding
practice history.

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

**From neetcode.io** — the set of problems you have marked complete. NeetCode's own page
fetches this when it loads and caches it in your browser's local storage; LeetSpacer reads
the copy that is already there and makes no request of its own.

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

LeetSpacer never sees, stores, or transmits a password or session token. Its requests to
LeetCode work because they run on leetcode.com and your browser attaches your existing
cookie automatically — the same way a normal page load does. LeetCode's session cookie is
marked `HttpOnly`, so it is not readable by extension code even in principle.

If you connect a GitHub repository (an optional feature for importing solve dates from a
NeetCode GitHub Sync repo), the personal access token you provide is stored in extension
storage under its own key and is used only to call `api.github.com` on your behalf. It is
deliberately kept out of the settings object so that exporting your data cannot leak it.

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
| `api.github.com` (optional) | Only requested if you connect a GitHub Sync repository. |

LeetSpacer requests no `tabs` permission, no `<all_urls>`, and executes no remotely hosted
code.

## Children

LeetSpacer is a developer tool and is not directed at children under 13.

## Changes

Material changes to this policy will be published in this file, and the "last updated"
date above will change. The file's full history is public in the repository.

## Contact

Questions or concerns: open an issue at
<https://github.com/CurtisLuu/leetcode-spaced/issues>.
