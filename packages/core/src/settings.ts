import type { Difficulty, ProviderId, TrackId } from "./model.js";
import type { SeedStrategy } from "./seeding.js";

export interface ProviderSettings {
  /**
   * Whether to read this site at all. Turning it off stops the sync but keeps everything
   * already collected, so the track it feeds goes quiet rather than empty.
   */
  enabled: boolean;
  /** Discovered from the site session, not entered by the user. */
  username: string | null;
  lastFullSyncAt: number | null;
  lastIncrementalSyncAt: number | null;
}

/**
 * Everything that shapes one track's schedule.
 *
 * Held per track rather than globally because the two tracks are working different
 * material at different sizes: a NeetCode track is a curriculum of a couple of hundred
 * problems, a LeetCode track is your whole submission history. Pacing that suits one
 * buries the other.
 */
export interface TrackSettings {
  /** Caps so a backlog can never bury the user. */
  dailyReviewLimit: number;
  dailyNewLimit: number;
  /** Share of the daily queue reserved for reviews, 0..1. Shifts with backlog and interview date. */
  reviewMixRatio: number;
  /** FSRS target retention, 0..1. Higher = more frequent reviews. */
  requestRetention: number;
  /**
   * How a freshly imported backlog is scheduled.
   *
   * Only applies to problems with no real solve date. A LeetCode problem read from your
   * submission history already has a genuine due date derived from when you solved it, and
   * redistributing that would throw away the best information the system has.
   */
  seedStrategy: SeedStrategy;
  seedSpreadDays: number;
  /** Curated lists to prioritize when picking new problems. */
  preferredLists: string[];
  /**
   * The shortest a problem may be locked after a review, in days, by its difficulty.
   *
   * FSRS thinks in flashcards, where seeing a card again ten minutes later is useful. A
   * coding problem is not a flashcard: re-solving one six minutes after the last attempt
   * measures nothing except short-term memory of the answer you just wrote. This is the
   * floor that keeps a learning-step interval from landing inside the same session.
   *
   * Only ever pushes a due date *out*. Everything above the floor is left to FSRS, so a
   * mature card's interval is untouched.
   */
  minimumLockDays: Record<Difficulty, number>;
}

export interface Settings {
  /**
   * Schema version of the *stored* settings, so a value that has gone stale can be
   * corrected exactly once instead of on every read.
   *
   * This exists because merging stored settings over defaults is not enough on its own:
   * a stored `false` beats a changed default forever, even when that `false` was never a
   * choice the user made. See `migrateStored`.
   */
  settingsVersion: number;
  providers: Record<ProviderId, ProviderSettings>;
  /** One independent schedule per track. */
  tracks: Record<TrackId, TrackSettings>;
  /**
   * When the privacy policy was accepted, or null if it hasn't been.
   *
   * Gates the *reading*, not the interface. Blocking the panel while the content scripts
   * carried on collecting would be a consent screen in appearance only — nothing is read
   * from either site until this is set.
   */
  privacyAcceptedAt: number | null;
  /**
   * Which revision of the policy was accepted.
   *
   * The policy promises that a material change is re-presented before the extension
   * carries on, and a promise in that document that the code doesn't keep is worse than
   * no promise. Bumping `PRIVACY_POLICY_VERSION` is what keeps it.
   *
   * Left at whatever revision was actually shown, even once a later one is carried
   * forward by `privacyAutoAcceptUpdates`. Advancing it would record an acceptance of a
   * document the user never saw, which is a worse record than an honest older one.
   */
  privacyAcceptedVersion: number | null;
  /**
   * Whether the user asked not to be re-prompted when the policy is revised.
   *
   * Set from the checkbox on the consent gate, so it is only ever recorded alongside a
   * real acceptance — there is no path to this being true without the user having read
   * and accepted the policy at least once.
   *
   * It does not carry every revision forward. A revision that expands what is read is
   * still presented, because pre-consent to a document nobody has written yet is not
   * consent to whatever it turns out to say. See `PRIVACY_FORCED_REACCEPT_VERSION`.
   */
  privacyAutoAcceptUpdates: boolean;
  /** Which track the UI is currently showing. Set by the selector in the side panel. */
  activeTrack: TrackId;
  /**
   * Which site a problem in the review queue opens on. NeetCode is the default because
   * that's where its video explanation and editorial live. Problems NeetCode has no page
   * for always fall back to LeetCode — see `@lcs/catalog`'s problem-links.
   */
  problemLinkTarget: ProviderId;
}

/**
 * NeetCode: a fixed curriculum with no solve dates, so everything is seeded and a short
 * window keeps the daily load steady.
 */
const NEETCODE_TRACK: TrackSettings = {
  dailyReviewLimit: 10,
  dailyNewLimit: 5,
  reviewMixRatio: 0.6,
  requestRetention: 0.9,
  seedStrategy: "spread",
  seedSpreadDays: 14,
  preferredLists: ["neetcode150"],
  minimumLockDays: { Easy: 4, Medium: 2, Hard: 1 },
};

/**
 * LeetCode: your full history, which is usually far larger and mostly carries real dates
 * already. Only the dateless remainder gets seeded, and across a wider window so that
 * remainder doesn't swamp the genuinely scheduled cards.
 */
const LEETCODE_TRACK: TrackSettings = {
  dailyReviewLimit: 15,
  dailyNewLimit: 5,
  reviewMixRatio: 0.6,
  requestRetention: 0.9,
  seedStrategy: "spread",
  seedSpreadDays: 30,
  preferredLists: [],
  minimumLockDays: { Easy: 4, Medium: 2, Hard: 1 },
};

/**
 * 1 -> 2: `providers.leetcode.enabled` defaulted to `false` while the LeetCode adapter
 * was deferred, and every settings write persisted that. There has never been a UI to
 * change it, so a stored `false` carries no intent — it's a stale default, and leaving it
 * in place means LeetCode silently never syncs on any install that predates the adapter.
 *
 * 2 -> 3: NeetCode's sync cursor was set by the completed-set reads, which predate the
 * submission-history walk by a long way. The two surfaces share one cursor, so the walk
 * inherited a recent timestamp and only ever ran incrementally — fetching the last day and
 * declaring the history done. Clearing the cursor buys exactly one full walk.
 */
export const SETTINGS_VERSION = 3;

/**
 * The revision of the privacy policy in `PRIVACY.md`.
 *
 * Bump it whenever that document changes materially — what is read, where it goes, or who
 * can see it. Doing so re-presents the policy and stops all reading until it is accepted
 * again, which is what the document says will happen.
 */
export const PRIVACY_POLICY_VERSION = 1;

/**
 * The earliest revision that everyone must accept in person, `privacyAutoAcceptUpdates`
 * or not.
 *
 * Raise it to the new `PRIVACY_POLICY_VERSION` whenever a revision *expands* the promise
 * — more read, read from somewhere new, or leaving the device at all. Those are exactly
 * the changes someone could not have anticipated when they ticked "don't ask me again",
 * so the tick doesn't cover them.
 *
 * Leave it alone for revisions that only narrow the promise or clarify wording. Those are
 * what the checkbox exists to skip.
 */
export const PRIVACY_FORCED_REACCEPT_VERSION = 1;

/**
 * Has this install accepted the policy as it currently stands?
 *
 * The two revision numbers are parameters rather than read straight from the constants so
 * the version arithmetic can be exercised while both constants still sit at 1 — the same
 * reason `seedCards` takes `now`. Callers pass neither.
 */
export function hasAcceptedPrivacy(
  settings: Settings,
  currentVersion: number = PRIVACY_POLICY_VERSION,
  forcedReacceptVersion: number = PRIVACY_FORCED_REACCEPT_VERSION,
): boolean {
  const accepted = settings.privacyAcceptedVersion;

  // Nothing has ever been accepted, so there is no acceptance to carry forward. Checked
  // first because the carry-forward below must never manufacture consent from scratch.
  if (accepted === null) return false;

  if (accepted === currentVersion) return true;

  // Accepted something older than the last expanding revision: that revision changed what
  // they were agreeing to, so it gets presented regardless of the checkbox.
  if (accepted < forcedReacceptVersion) return false;

  return settings.privacyAutoAcceptUpdates;
}

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  providers: {
    leetcode: { enabled: true, username: null, lastFullSyncAt: null, lastIncrementalSyncAt: null },
    neetcode: { enabled: true, username: null, lastFullSyncAt: null, lastIncrementalSyncAt: null },
  },
  tracks: { leetcode: LEETCODE_TRACK, neetcode: NEETCODE_TRACK },
  privacyAcceptedAt: null,
  privacyAcceptedVersion: null,
  privacyAutoAcceptUpdates: false,
  activeTrack: "neetcode",
  problemLinkTarget: "neetcode",
};

/**
 * Settings as they were before schedule options moved under `tracks`.
 *
 * Kept as a type rather than deleted because stored settings outlive the code that wrote
 * them: an install that hasn't been opened since the split still has these at the top
 * level, and silently resetting someone's tuned limits to defaults is not an upgrade.
 */
interface LegacyScheduleSettings {
  dailyReviewLimit?: number;
  dailyNewLimit?: number;
  reviewMixRatio?: number;
  requestRetention?: number;
  seedStrategy?: SeedStrategy;
  seedSpreadDays?: number;
  preferredLists?: string[];
}

const LEGACY_KEYS = [
  "dailyReviewLimit",
  "dailyNewLimit",
  "reviewMixRatio",
  "requestRetention",
  "seedStrategy",
  "seedSpreadDays",
  "preferredLists",
] as const;

/**
 * Just the pre-split schedule fields, and only the ones actually present.
 *
 * Picked key by key rather than spread wholesale: the stored object also holds
 * `providers`, `tracks` and friends, and spreading it into a track would graft
 * every one of them onto every track — which then round-trips back into storage.
 */
function pickLegacy(source: LegacyScheduleSettings): Partial<TrackSettings> {
  const picked: Record<string, unknown> = {};
  for (const key of LEGACY_KEYS) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked as Partial<TrackSettings>;
}

function trackWithDefaults(
  fallback: TrackSettings,
  stored: Partial<TrackSettings> | undefined,
  legacy: LegacyScheduleSettings,
): TrackSettings {
  // Precedence: what was stored for this track, then whatever the pre-split settings
  // said, then this track's defaults.
  const merged = { ...fallback, ...pickLegacy(legacy), ...stored };
  return {
    ...merged,
    preferredLists: [...merged.preferredLists],
    // Spread over the fallback rather than replacing it: a stored object missing a
    // difficulty would otherwise leave that one undefined and the clamp reading NaN.
    minimumLockDays: { ...fallback.minimumLockDays, ...merged.minimumLockDays },
  };
}

/**
 * One-time corrections to values that have gone stale on disk.
 *
 * Runs before the merge, so a corrected value is treated as if it had been stored that
 * way. Guarded on `settingsVersion` rather than applied unconditionally: once the user
 * *can* change a setting, their choice has to survive, and a migration that ran on every
 * read would keep undoing it.
 */
function migrateStored(stored: Partial<Settings>): Partial<Settings> {
  const version = stored.settingsVersion ?? 1;
  if (version >= SETTINGS_VERSION) return stored;

  const providers = { ...stored.providers } as Settings["providers"] | undefined;

  if (version < 2 && providers?.leetcode) {
    // Never a user decision — there was no control for it — so a stored `false` here is
    // only ever the old default, from when the adapter didn't exist.
    providers.leetcode = { ...providers.leetcode, enabled: true };
  }

  if (version < 3 && providers?.neetcode) {
    // Cleared, not backdated: the walk needs to start from nothing to cover the history
    // the completed-set reads never had dates for. Costs one full pass, then settles back
    // to incremental on its own.
    providers.neetcode = {
      ...providers.neetcode,
      lastFullSyncAt: null,
      lastIncrementalSyncAt: null,
    };
  }

  return { ...stored, providers, settingsVersion: SETTINGS_VERSION };
}

/**
 * Merge stored settings over defaults so added fields don't break existing installs.
 * Always returns a fresh object — nothing here aliases DEFAULT_SETTINGS.
 */
export function withDefaults(raw: Partial<Settings> | undefined): Settings {
  const stored = raw === undefined ? undefined : migrateStored(raw);
  const legacy = (stored ?? {}) as LegacyScheduleSettings;

  // Built field by field rather than spread over `stored`. A spread would copy the
  // pre-split top-level keys straight back out again, and since every `update` writes the
  // result back, they'd be re-saved forever after they stopped meaning anything.
  return {
    settingsVersion: SETTINGS_VERSION,
    providers: {
      leetcode: { ...DEFAULT_SETTINGS.providers.leetcode, ...stored?.providers?.leetcode },
      neetcode: { ...DEFAULT_SETTINGS.providers.neetcode, ...stored?.providers?.neetcode },
    },
    tracks: {
      leetcode: trackWithDefaults(LEETCODE_TRACK, stored?.tracks?.leetcode, legacy),
      neetcode: trackWithDefaults(NEETCODE_TRACK, stored?.tracks?.neetcode, legacy),
    },
    // Never defaulted to "accepted": consent that the code assumes is not consent.
    privacyAcceptedAt: stored?.privacyAcceptedAt ?? null,
    privacyAcceptedVersion: stored?.privacyAcceptedVersion ?? null,
    // Same reasoning as the two above: never defaulted on, only ever stored because the
    // user ticked the box.
    privacyAutoAcceptUpdates: stored?.privacyAutoAcceptUpdates ?? false,
    activeTrack: stored?.activeTrack ?? DEFAULT_SETTINGS.activeTrack,
    problemLinkTarget: stored?.problemLinkTarget ?? DEFAULT_SETTINGS.problemLinkTarget,
  };
}
