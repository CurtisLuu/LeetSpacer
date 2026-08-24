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
   * Left at whatever revision was actually shown, even once a later minor one is carried
   * forward. Advancing it would record an acceptance of a document the user never saw,
   * which is a worse record than an honest older one.
   */
  privacyAcceptedVersion: number | null;
  /** Which track the UI is currently showing. Set by the selector in the side panel. */
  activeTrack: TrackId;
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
 *
 * 3 -> 4: `problemLinkTarget` chose between a fixed site and the track's own. The
 * setting is gone — a track now always opens its own site — so the migration went with
 * it. `withDefaults` builds field by field, so a stored value is dropped on the next
 * write without needing one.
 */
export const SETTINGS_VERSION = 4;

/** One published revision of `PRIVACY.md`. */
export interface PrivacyRevision {
  version: number;
  /** The `Effective` line at the top of `PRIVACY.md` when this revision shipped. */
  effective: string;
  /**
   * sha256 of `PRIVACY.md` as it stood at this revision.
   *
   * Kept here rather than in a build script so that a revision is one literal in one
   * place. `privacy-policy.test.ts` checks the file against it, and `pnpm zip` runs the
   * tests, so the policy cannot be edited and shipped without a revision being declared.
   */
  sha256: string;
  /**
   * Whether an earlier acceptance still stands after this revision, so nobody is asked
   * again for it.
   *
   * This is our call to make per revision, not the user's — which is how everyone else
   * does it, and the only workable way: a user asked to pre-approve a revision would be
   * deciding about a document they have not read.
   *
   * Omit it and the answer is no: everyone is asked again. That is the direction to fail
   * in, because forgetting to think about a revision is exactly when you most want the
   * user asked. Set it to `true` only for a revision that changes nothing about what
   * LeetSpacer does with someone's data — wording, formatting, clarification.
   *
   * Never set it on a revision that reads more, reads from somewhere new, sends anything
   * off the device, narrows what the user can export or delete, or changes who publishes
   * the extension. `PRIVACY.md` promises those always stop the extension.
   */
  carriesForward?: boolean;
}

/**
 * Every published revision of `PRIVACY.md`, oldest first.
 *
 * Appending an entry is the whole procedure for a policy change: it moves
 * `PRIVACY_POLICY_VERSION`, records the effective date, and states whether the revision
 * can be carried forward — the three things that used to be separate and could drift.
 */
export const PRIVACY_REVISIONS: readonly PrivacyRevision[] = [
  {
    version: 1,
    // Amended before 1.0.0 shipped, so this revision has never been shown to anyone and
    // there is no acceptance of an earlier text to carry forward: the `storage`
    // permission row came out when the permission did, the credentials section now says
    // how the NeetCode token is passed between LeetSpacer's own scripts, and the deletion
    // controls now include erasing one site's data on its own. Once this is published, an
    // entry is appended instead of edited.
    effective: "18 August 2026",
    sha256: "e87046963a9afd6838d6e67ff218b6715007a95b6d503f2208613340c76d2b17",
  },
];

/** The newest declared revision. */
function currentRevision(revisions: readonly PrivacyRevision[]): PrivacyRevision {
  const latest = revisions[revisions.length - 1];
  if (latest === undefined) throw new Error("PRIVACY_REVISIONS must not be empty.");
  return latest;
}

/**
 * The revision of the privacy policy in `PRIVACY.md` that this build ships.
 *
 * Derived rather than written down twice — the list is the source of truth.
 */
export const PRIVACY_POLICY_VERSION = currentRevision(PRIVACY_REVISIONS).version;

/**
 * Has this install accepted the policy as it currently stands?
 *
 * `revisions` is a parameter rather than read straight from the constant so the version
 * arithmetic can be exercised while only one revision exists — the same reason
 * `seedCards` takes `now`. Callers pass nothing.
 */
export function hasAcceptedPrivacy(
  settings: Settings,
  revisions: readonly PrivacyRevision[] = PRIVACY_REVISIONS,
): boolean {
  const accepted = settings.privacyAcceptedVersion;

  // Nothing has ever been accepted, so there is no acceptance to carry forward. Checked
  // first because the carry-forward below must never manufacture consent from scratch.
  if (accepted === null) return false;

  if (accepted === currentRevision(revisions).version) return true;

  // Every revision published since the one they accepted has to be carryable. Checking
  // all of them rather than a single threshold means a major revision can't be smuggled
  // past by a later minor one, and nothing has to be remembered when the next one ships.
  return revisions.every((r) => r.version <= accepted || r.carriesForward === true);
}

/**
 * A snapshot's settings with the acceptance record removed.
 *
 * Consent is not data — it is a record of something the person in front of the browser
 * did, and a file cannot do it for them. Without this, importing a JSON file whose
 * `settings` happen to carry `privacyAcceptedAt` would mark the policy accepted on this
 * install, which is a consent gate that a file can open.
 *
 * Everything else in the snapshot is theirs to restore. Merging the result over the
 * current settings leaves the local acceptance exactly as it was.
 */
export function settingsWithoutConsent(
  settings: Settings,
): Omit<Settings, "privacyAcceptedAt" | "privacyAcceptedVersion"> {
  const { privacyAcceptedAt: _at, privacyAcceptedVersion: _version, ...rest } = settings;
  return rest;
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
  activeTrack: "neetcode",
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
    activeTrack: stored?.activeTrack ?? DEFAULT_SETTINGS.activeTrack,
  };
}
