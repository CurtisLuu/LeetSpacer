import type { RoadmapTopic } from "@lcs/core";

import problemsData from "../data/problems.json" with { type: "json" };
import roadmapData from "../data/roadmap.json" with { type: "json" };
import { type Catalog, type CatalogData, createCatalog } from "./catalog.js";

export * from "./catalog.js";
export * from "./roadmap.js";

export const ROADMAP_TOPICS: readonly RoadmapTopic[] = roadmapData.topics;

let cached: Catalog | undefined;

/**
 * The bundled catalog. Built by `pnpm catalog:build`; ships inside the extension so
 * recommendations are instant and work offline, and so we never hit LeetCode just to
 * learn which problems exist.
 */
export function bundledCatalog(): Catalog {
  cached ??= createCatalog(problemsData as unknown as CatalogData, ROADMAP_TOPICS);
  return cached;
}
