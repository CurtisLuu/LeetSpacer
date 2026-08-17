import type { ProviderId } from "./model.js";
import type { SeedStrategy } from "./seeding.js";

export interface ProviderSettings {
  enabled: boolean;
  /** Discovered from the site session, not entered by the user. */
  username: string | null;
  lastFullSyncAt: number | null;
  lastIncrementalSyncAt: number | null;
}

/**
 * The GitHub repository NeetCode syncs your solutions to.
 *
 * No token here on purpose — a personal access token is a credential, and Settings gets
 * written into every export. The token lives in extension storage under its own key so
 * exporting your data can never leak it.
 */
export interface GithubSourceSettings {
  /** "owner/repo", or null when not connected. */
  repo: string | null;
  lastSyncAt: number | null;
  /** Human-readable outcome of the last sync, success or failure. */
  lastResult: string | null;
}

export interface Settings {
  providers: Record<ProviderId, ProviderSettings>;
  github: GithubSourceSettings;
  /** Caps so a backlog can never bury the user. */
  dailyReviewLimit: number;
  dailyNewLimit: number;
  /** Share of the daily queue reserved for reviews, 0..1. Shifts with backlog and interview date. */
  reviewMixRatio: number;
  /** FSRS target retention, 0..1. Higher = more frequent reviews. */
  requestRetention: number;
  /**
   * How a freshly imported backlog is scheduled. NeetCode carries no solve dates, so
   * this decides whether everything is due at once or fanned out over a window.
   */
  seedStrategy: SeedStrategy;
  seedSpreadDays: number;
  /** Curated lists to prioritize when picking new problems. */
  preferredLists: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    leetcode: { enabled: false, username: null, lastFullSyncAt: null, lastIncrementalSyncAt: null },
    neetcode: { enabled: true, username: null, lastFullSyncAt: null, lastIncrementalSyncAt: null },
  },
  github: { repo: null, lastSyncAt: null, lastResult: null },
  dailyReviewLimit: 10,
  dailyNewLimit: 5,
  reviewMixRatio: 0.6,
  requestRetention: 0.9,
  seedStrategy: "spread",
  seedSpreadDays: 14,
  preferredLists: ["neetcode150"],
};

/**
 * Merge stored settings over defaults so added fields don't break existing installs.
 * Always returns a fresh object — nothing here aliases DEFAULT_SETTINGS.
 */
export function withDefaults(stored: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: {
      leetcode: { ...DEFAULT_SETTINGS.providers.leetcode, ...stored?.providers?.leetcode },
      neetcode: { ...DEFAULT_SETTINGS.providers.neetcode, ...stored?.providers?.neetcode },
    },
    github: { ...DEFAULT_SETTINGS.github, ...stored?.github },
    preferredLists: [...(stored?.preferredLists ?? DEFAULT_SETTINGS.preferredLists)],
  };
}
