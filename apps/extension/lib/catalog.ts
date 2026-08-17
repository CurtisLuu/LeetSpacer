import { ROADMAP_TOPICS, type Catalog, type CatalogData, createCatalog } from "@lcs/catalog";

/**
 * Loads the problem dataset from the extension's own static assets.
 *
 * Deliberately not `bundledCatalog()` from `@lcs/catalog` — that import inlines ~1 MB of
 * JSON into whichever bundle touches it. Here it's fetched once, on demand, and held in
 * memory for as long as the context lives.
 */
const CATALOG_URL = "/catalog/problems.json" as const;

let pending: Promise<Catalog> | undefined;

export function getCatalog(): Promise<Catalog> {
  pending ??= (async () => {
    const response = await fetch(browser.runtime.getURL(CATALOG_URL));
    if (!response.ok) {
      throw new Error(`Catalog missing (HTTP ${response.status}). Run pnpm catalog:build.`);
    }
    return createCatalog((await response.json()) as CatalogData, ROADMAP_TOPICS);
  })();
  return pending;
}
