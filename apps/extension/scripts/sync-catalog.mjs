/**
 * Copies the generated catalog data into `public/` so it ships as static JSON files
 * rather than being bundled into JavaScript.
 *
 * This matters: an MV3 service worker is torn down and restarted constantly, and
 * anything bundled into background.js gets re-parsed on every wake. As static assets
 * they're fetched lazily, only by the code that actually needs them.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = resolve(here, "../../../packages/catalog/data");
const publicCatalog = resolve(here, "../public/catalog");

const files = ["problems.json", "neetcode-slugs.json"];

await mkdir(publicCatalog, { recursive: true });
await Promise.all(
  files.map((file) => copyFile(resolve(data, file), resolve(publicCatalog, file))),
);
