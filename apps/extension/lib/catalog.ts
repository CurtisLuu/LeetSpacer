import {
  EMPTY_PROBLEM_LINKS,
  ROADMAP_TOPICS,
  type Catalog,
  type CatalogData,
  type NeetcodeSlugData,
  type ProblemLinks,
  createCatalog,
  createProblemLinks,
} from "@lcs/catalog";
import type { PublicPath } from "wxt/browser";

/**
 * Loads the catalog datasets from the extension's own static assets.
 *
 * Deliberately not `bundledCatalog()` from `@lcs/catalog` — that import inlines ~1 MB of
 * JSON into whichever bundle touches it. Here they're fetched once, on demand, and held
 * in memory for as long as the context lives.
 */
const CATALOG_URL = "/catalog/problems.json" as const;
const NEETCODE_SLUGS_URL = "/catalog/neetcode-slugs.json" as const;

let pending: Promise<Catalog> | undefined;
let pendingLinks: Promise<ProblemLinks> | undefined;

/**
 * WXT generates `PublicPath` from the actual contents of `public/`, so a path that isn't
 * shipped fails to compile rather than 404ing at runtime. Worth keeping over `string`:
 * the last thing a missing asset should be is a silent runtime surprise.
 */
async function readAsset(url: PublicPath): Promise<unknown> {
  const response = await fetch(browser.runtime.getURL(url));
  if (!response.ok) throw new Error(`${url} missing (HTTP ${response.status})`);
  return response.json();
}

export function getCatalog(): Promise<Catalog> {
  pending ??= (async () => {
    try {
      return createCatalog((await readAsset(CATALOG_URL)) as CatalogData, ROADMAP_TOPICS);
    } catch (error) {
      // Re-throwing loses the actionable half of the message.
      // Developer detail; the interface never shows this string.
      throw new Error(`${(error as Error).message}. Run pnpm catalog:build.`);
    }
  })();

  // A rejected promise must not stay in the cache. One failed fetch — a worker starting
  // while the profile was busy, a transient read — would otherwise poison this context
  // for as long as it lives: every later call gets the same rejection, so titles and
  // difficulties never come back until the panel is closed and reopened.
  return pending.catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}

/**
 * The LeetCode-slug -> NeetCode-slug map, used to decide where a queue item opens.
 *
 * Never rejects: a missing map only means every problem links to LeetCode, which is a
 * worse link but not a broken feature, and failing here would take the queue down with it.
 */
export function getProblemLinks(): Promise<ProblemLinks> {
  // No retry needed on this one: it resolves to an empty map rather than rejecting, so
  // there is never a rejection to cache.
  pendingLinks ??= (async () => {
    try {
      return createProblemLinks((await readAsset(NEETCODE_SLUGS_URL)) as NeetcodeSlugData);
    } catch (error) {
      console.error("[lcs] NeetCode slug map unavailable, linking to LeetCode", error);
      return createProblemLinks(EMPTY_PROBLEM_LINKS);
    }
  })();
  return pendingLinks;
}
