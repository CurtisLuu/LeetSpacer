/**
 * Copies the generated problem dataset into `public/` so it ships as a static JSON file
 * rather than being bundled into JavaScript.
 *
 * This matters: an MV3 service worker is torn down and restarted constantly, and
 * anything bundled into background.js gets re-parsed on every wake. As a static asset
 * it's fetched lazily, only by the code that actually needs it.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../packages/catalog/data/problems.json");
const destination = resolve(here, "../public/catalog/problems.json");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
