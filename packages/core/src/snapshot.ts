import type { StoreSnapshot } from "./store.js";

/**
 * Validate untrusted JSON before it reaches the store.
 *
 * Casting parsed JSON straight to `StoreSnapshot` lets anything through, and a
 * half-applied import is far worse than a rejected one. The error messages name what was
 * wrong with the file, since "import failed" tells nobody anything.
 */
export function parseSnapshot(text: string): StoreSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("That JSON isn't an object.");
  }

  const candidate = parsed as Partial<StoreSnapshot> & { records?: unknown };

  // Capture-mode exports are the most likely wrong file to reach this, and they look
  // nothing like a snapshot — worth saying so by name.
  if (Array.isArray(candidate.records)) {
    throw new Error(
      "That looks like a capture-mode export, not a data snapshot. Use a file from Export JSON, or one produced by pnpm import:neetcode.",
    );
  }

  if (candidate.version !== 1) {
    throw new Error(
      `Expected a snapshot with version 1, found ${JSON.stringify(candidate.version)}.`,
    );
  }

  for (const key of ["events", "problems", "cards", "logs"] as const) {
    if (!Array.isArray(candidate[key])) {
      throw new Error(`Snapshot is missing its "${key}" list.`);
    }
  }

  return candidate as StoreSnapshot;
}
