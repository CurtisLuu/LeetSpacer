/**
 * Regenerates `data/neetcode-slugs.json`: the LeetCode slug -> NeetCode slug mapping.
 *
 * This is a *developer* build step, like `build-catalog.ts`. The extension ships the
 * result and never derives it at runtime.
 *
 * ## Why this is needed
 *
 * NeetCode identifies problems in its *progress* data by LeetCode URL, which is why
 * everything downstream is keyed by LeetCode slug (see docs/providers.md). But its own
 * problem *pages* live under NeetCode's renamed slugs — `two-sum` is served at
 * `/problems/two-integer-sum`, `valid-anagram` at `/problems/is-anagram`. To send someone
 * to NeetCode we have to translate.
 *
 * ## Where the mapping comes from
 *
 * Two public sources, neither of which requires an account or a single authenticated
 * request:
 *
 *   1. `neetcode.io/sitemap.xml` — every `/problems/<nc>` URL, so the complete set of
 *      NeetCode slugs. Note that `/solutions/<slug>` in the same sitemap is keyed by
 *      *LeetCode* slug, not NeetCode's; mixing the two produces mappings that 404, so
 *      only the `/problems/` section is read here.
 *   2. The app bundle's rename table. NeetCode ships a literal
 *      `{"<nc-slug>": "<lc-slug>"}` object for the problems it renamed; it is used to
 *      normalize a NeetCode slug back to LeetCode's before looking up a visualization.
 *      Chunk filenames are content-hashed, so we rediscover them from the page each run
 *      rather than pinning a URL that dies on NeetCode's next deploy.
 *
 * Everything the rename table doesn't cover is assumed to keep LeetCode's slug, and that
 * assumption is *checked* against the bundled catalog: a NeetCode slug that resolves to no
 * known LeetCode problem is reported rather than written, so a silent miss becomes a
 * visible one.
 *
 * Usage: pnpm neetcode:map
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Problem } from "@lcs/core";

const ORIGIN = "https://neetcode.io";
const CONCURRENCY = 8;
const USER_AGENT = "leetspacer-neetcode-map (dev build script)";

/**
 * Renames the bundle's table misses, because NeetCode only ships a rename entry for
 * problems that have a visualization. Each is a NeetCode slug whose identity guess
 * matched nothing in the LeetCode catalog; the script fails loudly if this list ever goes
 * stale, so it can't quietly rot.
 */
const MANUAL_RENAMES: Record<string, string> = {
  "reorder-linked-list": "reorder-list",
  "search-2d-matrix": "search-a-2d-matrix",
  "merge-triplets-to-form-target": "merge-triplets-to-form-target-triplet",
};

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, "../data/problems.json");
const outputPath = resolve(here, "../data/neetcode-slugs.json");

async function get(path: string): Promise<string> {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`GET ${path} returned HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** Every `/problems/<slug>` page NeetCode publishes, in NeetCode's own slug space. */
async function fetchNeetcodeSlugs(): Promise<Set<string>> {
  const xml = await get("/sitemap.xml");
  const slugs = new Set<string>();

  for (const match of xml.matchAll(/<loc>https:\/\/neetcode\.io\/problems\/([a-z0-9-]+)/g)) {
    if (match[1]) slugs.add(match[1]);
  }

  if (slugs.size === 0) {
    throw new Error("sitemap.xml listed no problem URLs — its shape has probably changed.");
  }
  return slugs;
}

/**
 * The lazy-loaded chunk URLs, discovered rather than hardcoded: the practice page names
 * `runtime.<hash>.js`, and the runtime holds the chunk-id -> content-hash table.
 */
async function fetchChunkPaths(): Promise<string[]> {
  const html = await get("/practice");
  const runtimeName = /src="(runtime\.[a-f0-9]+\.js)"/.exec(html)?.[1];
  if (!runtimeName) {
    throw new Error("Couldn't find runtime.<hash>.js on /practice — the app shell has changed.");
  }

  const runtime = await get(`/${runtimeName}`);
  const paths = [...runtime.matchAll(/([0-9]+):"([a-f0-9]{16})"/g)].map(
    ([, id, hash]) => `/${id}.${hash}.js`,
  );

  if (paths.length === 0) {
    throw new Error(`No chunk hashes in ${runtimeName} — Angular's runtime format has changed.`);
  }
  return paths;
}

/** Balanced-brace slice starting at `open`, so a nested object doesn't truncate it. */
function objectLiteralAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error("Unbalanced object literal in chunk.");
}

/**
 * NeetCode slug -> LeetCode slug, scraped from whichever chunk carries the rename table.
 *
 * Identified by content, not position: we look for the object literal containing a rename
 * we know exists. Minified identifiers change on every build, so anything keyed off a
 * variable name would break immediately.
 */
async function fetchRenames(chunkPaths: string[]): Promise<Record<string, string>> {
  const ANCHOR = '"is-anagram":"valid-anagram"';
  let found: string | null = null;

  for (let i = 0; i < chunkPaths.length && !found; i += CONCURRENCY) {
    const batch = chunkPaths.slice(i, i + CONCURRENCY);
    const bodies = await Promise.all(
      batch.map((path) => get(path).catch(() => "")),
    );
    for (const body of bodies) {
      const at = body.indexOf(ANCHOR);
      if (at === -1) continue;
      found = objectLiteralAt(body, body.lastIndexOf("{", at));
      break;
    }
  }

  if (!found) {
    throw new Error(
      `No chunk contained ${ANCHOR}. NeetCode may have moved the rename table — re-check ` +
        "the bundle before trusting this script's output.",
    );
  }

  const renames: Record<string, string> = {};
  for (const match of found.matchAll(/"([a-z0-9-]+)":"([a-z0-9-]+)"/g)) {
    if (match[1] && match[2]) renames[match[1]] = match[2];
  }
  return renames;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { problems: Problem[] };
  const known = new Set(catalog.problems.map((problem) => problem.slug));
  if (known.size === 0) throw new Error("Catalog is empty — run pnpm catalog:build first.");

  const [ncSlugs, chunkPaths] = await Promise.all([fetchNeetcodeSlugs(), fetchChunkPaths()]);
  const renames = await fetchRenames(chunkPaths);
  console.log(
    `${ncSlugs.size} NeetCode slugs, ${Object.keys(renames).length} renames from the bundle`,
  );

  /** LeetCode slug -> NeetCode slug. Sorted on write so diffs stay readable. */
  const bySlug: Record<string, string> = {};
  const unresolved: string[] = [];
  const usedManual = new Set<string>();

  for (const nc of [...ncSlugs].sort()) {
    const manual = MANUAL_RENAMES[nc];
    if (manual) usedManual.add(nc);
    const lc = renames[nc] ?? manual ?? nc;

    if (!known.has(lc)) {
      unresolved.push(nc);
      continue;
    }
    bySlug[lc] ??= nc;
  }

  const stale = Object.keys(MANUAL_RENAMES).filter((nc) => !usedManual.has(nc));
  if (stale.length > 0) {
    console.warn(
      `MANUAL_RENAMES has ${stale.length} entries NeetCode no longer publishes: ${stale.join(", ")}`,
    );
  }

  if (unresolved.length > 0) {
    console.warn(
      `\n${unresolved.length} NeetCode slugs resolved to no LeetCode problem. Add each to ` +
        `MANUAL_RENAMES (or accept the loss — those problems just link to LeetCode):\n  ` +
        unresolved.join("\n  "),
    );
  }

  const mapped = Object.keys(bySlug).length;
  if (mapped < 400) {
    throw new Error(
      `Only mapped ${mapped} problems, well below the ~590 NeetCode publishes problem pages ` +
        "for. Refusing to overwrite the existing map with a partial scrape.",
    );
  }

  const sorted = Object.fromEntries(Object.entries(bySlug).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), bySlug: sorted }, null, 0)}\n`,
  );

  console.log(`wrote ${mapped} slug mappings to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(
    `\nneetcode map build failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
