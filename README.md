# leetcode-spaced

A Chrome extension that reads your own LeetCode and NeetCode progress and tells you what
to practice next — due reviews scheduled by spaced repetition, plus new problems chosen
to fill topic gaps, mined from failures, and weighted toward a target company.

Everything stays on your device. There is no backend and no account.

## Status

P1 (skeleton) is complete: the monorepo, domain model, persistence, catalog, and a
loading extension shell. The adapters that actually read the sites land in P2 (LeetCode)
and P4 (NeetCode), and they're gated on the recon in [`docs/providers.md`](docs/providers.md).

**NeetCode history works.** LeetCode is stripped for now — no content script, no host
permission — until its adapter is worked out.

Just open [neetcode.io/practice](https://neetcode.io/practice) while signed in. Your
completed problems sync automatically: no button, no token, no configuration.

It works because NeetCode's own page fetches your completed set on load, and caches it in
`localStorage`. The extension reads what's already there — it issues no requests of its
own and never touches an auth token. See [`docs/providers.md`](docs/providers.md) for the
exact shapes.

Crucially, NeetCode identifies problems by **LeetCode URL**, so everything is keyed by
LeetCode slug and joins straight to the bundled catalogue for real titles, difficulty, and
topic tags.

### Scheduling an imported backlog

NeetCode records *that* a problem is done, never when. Seeding a card as "solved just now"
puts it in FSRS's learning state, due in about ten minutes — so the queue looks empty and
then dumps everything at once. Two strategies, in Settings:

- **Spread** (default) — fans the backlog across a window, hardest problems first, so a
  steady few come due each day.
- **Everything now** — the whole backlog is due immediately, paced by the daily limit.

**Apply to existing problems** re-runs this over anything you haven't graded yet; problems
with review history are never touched.

Real solve dates are available from a NeetCode GitHub Sync repository, whose commit dates
are genuine, via `pnpm import:neetcode`. That path needs a NeetCode-slug to LeetCode-slug
mapping before it can be re-exposed in the UI — NeetCode's own slugs (`is-anagram`) differ
from LeetCode's (`valid-anagram`), and mixing the two produces duplicate problems.

See the full plan in `~/.claude/plans/melodic-brewing-sundae.md`.

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | Domain model, event folding, `Store` interface. Pure TypeScript — no browser APIs, no framework. |
| `packages/store` | IndexedDB implementation of `Store`. |
| `packages/catalog` | The bundled problem dataset (4,028 problems) and the NeetCode roadmap DAG. |
| `packages/providers` | The site-adapter interface. Adapters land here in P2/P4. |
| `apps/extension` | WXT + React: background worker, side panel, popup, options, content scripts. |

The important boundary: `@lcs/core` knows nothing about browsers or websites, so the
scheduler and recommender are testable in Node and reusable verbatim if a web dashboard
is ever added. Persistence goes through one interface, which is the entire cost of adding
sync later.

## Develop

```sh
pnpm install
pnpm dev            # runs the extension in a dev browser with HMR
pnpm test           # 96 tests across core, store, catalog, providers, importers
pnpm typecheck
pnpm build          # production build -> apps/extension/.output/chrome-mv3
pnpm catalog:build  # regenerate the problem dataset from LeetCode's public API
```

To load it manually: `pnpm build`, then Chrome → Extensions → Developer mode → **Load
unpacked** → `apps/extension/.output/chrome-mv3`.

Node 20+ required. `pnpm catalog:build` is a developer step — the dataset ships bundled so
the extension never generates traffic just to learn which problems exist.

## Data and permissions

- Permissions requested: `storage`, `sidePanel`, `alarms`, and host access to
  `leetcode.com` and `neetcode.io`. No `tabs`, no `<all_urls>`, no remote code.
- All reads happen from a content script on the site's own origin, using the session
  you're already signed in with. The extension never handles a credential, never makes a
  cross-origin request, and never transmits anything off your machine.
- Requests are throttled and prefer incremental sync.
- Company-tag data is community-sourced and used as a weighting hint, never a hard
  filter — LeetCode gates real company tags behind Premium.
