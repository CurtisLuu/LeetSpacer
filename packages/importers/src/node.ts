/**
 * Node-only entry point: reads a local clone via `git`.
 *
 * Kept out of the default export so bundling the browser-safe importer into the
 * extension doesn't drag `node:child_process` in with it.
 */

export * from "./git.js";
