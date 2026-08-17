import type { RoadmapTopic } from "@lcs/core";

import neetcodeSlugData from "../data/neetcode-slugs.json" with { type: "json" };
import problemsData from "../data/problems.json" with { type: "json" };
import roadmapData from "../data/roadmap.json" with { type: "json" };
import { type Catalog, type CatalogData, createCatalog } from "./catalog.js";
import {
  type NeetcodeSlugData,
  type ProblemLinks,
  createProblemLinks,
} from "./problem-links.js";

export * from "./catalog.js";
export * from "./problem-links.js";
export * from "./roadmap.js";

export const ROADMAP_TOPICS: readonly RoadmapTopic[] = roadmapData.topics;

let cached: Catalog | undefined;
let cachedLinks: ProblemLinks | undefined;

/**
 * The bundled catalog. Built by `pnpm catalog:build`; ships inside the extension so
 * recommendations are instant and work offline, and so we never hit LeetCode just to
 * learn which problems exist.
 */
export function bundledCatalog(): Catalog {
  cached ??= createCatalog(problemsData as unknown as CatalogData, ROADMAP_TOPICS);
  return cached;
}

/**
 * The bundled LeetCode-slug -> NeetCode-slug map. Built by `pnpm neetcode:map`.
 *
 * Same caveat as `bundledCatalog`: importing this inlines the JSON, so the extension
 * fetches it as a static asset instead (see `apps/extension/lib/catalog.ts`).
 */
export function bundledProblemLinks(): ProblemLinks {
  cachedLinks ??= createProblemLinks(neetcodeSlugData as NeetcodeSlugData);
  return cachedLinks;
}
