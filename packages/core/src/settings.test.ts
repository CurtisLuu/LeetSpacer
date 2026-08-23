import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  PRIVACY_POLICY_VERSION,
  type PrivacyRevision,
  SETTINGS_VERSION,
  type Settings,
  hasAcceptedPrivacy,
  linkTargetFor,
  settingsWithoutConsent,
  withDefaults,
} from "./settings.js";

describe("withDefaults", () => {
  it("fills in everything from nothing", () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("never hands back a reference into DEFAULT_SETTINGS", () => {
    // Settings are mutated by callers building a patch; aliasing the defaults would let
    // one install's edit leak into the constant every other read starts from.
    const settings = withDefaults(undefined);
    settings.tracks.neetcode.preferredLists.push("mutated");

    expect(DEFAULT_SETTINGS.tracks.neetcode.preferredLists).toEqual(["neetcode150"]);
  });

  it("gives the two tracks different starting pace", () => {
    const { tracks } = withDefaults(undefined);

    // A LeetCode history is typically far larger than a NeetCode curriculum, so its
    // backlog is fanned across a wider window.
    expect(tracks.leetcode.seedSpreadDays).toBeGreaterThan(tracks.neetcode.seedSpreadDays);
    expect(tracks.leetcode).not.toEqual(tracks.neetcode);
  });

  it("keeps a stored track and defaults the other", () => {
    const stored = {
      tracks: { leetcode: { dailyReviewLimit: 42 } },
    } as unknown as Partial<Settings>;

    const { tracks } = withDefaults(stored);
    expect(tracks.leetcode.dailyReviewLimit).toBe(42);
    expect(tracks.leetcode.requestRetention).toBe(0.9);
    expect(tracks.neetcode).toEqual(DEFAULT_SETTINGS.tracks.neetcode);
  });

  it("tunes tracks independently", () => {
    const stored = {
      tracks: {
        leetcode: { ...DEFAULT_SETTINGS.tracks.leetcode, dailyReviewLimit: 40 },
        neetcode: { ...DEFAULT_SETTINGS.tracks.neetcode, dailyReviewLimit: 3 },
      },
    } as Partial<Settings>;

    const { tracks } = withDefaults(stored);
    expect(tracks.leetcode.dailyReviewLimit).toBe(40);
    expect(tracks.neetcode.dailyReviewLimit).toBe(3);
  });
});

describe("settings stored before the track split", () => {
  /** What an install that hasn't been opened since the split still has on disk. */
  const legacy = {
    dailyReviewLimit: 25,
    dailyNewLimit: 7,
    requestRetention: 0.85,
    seedStrategy: "now",
    seedSpreadDays: 21,
    preferredLists: ["blind75"],
    providers: DEFAULT_SETTINGS.providers,
  } as unknown as Partial<Settings>;

  it("lifts the old tuning into both tracks rather than resetting it", () => {
    const { tracks } = withDefaults(legacy);

    for (const track of [tracks.leetcode, tracks.neetcode]) {
      expect(track.dailyReviewLimit).toBe(25);
      expect(track.dailyNewLimit).toBe(7);
      expect(track.requestRetention).toBe(0.85);
      expect(track.seedStrategy).toBe("now");
      expect(track.seedSpreadDays).toBe(21);
      expect(track.preferredLists).toEqual(["blind75"]);
    }
  });

  it("doesn't carry the old top-level keys back out", () => {
    // `update` writes whatever this returns straight back to storage, so a key echoed
    // here would be re-saved forever after it stopped meaning anything.
    const result = withDefaults(legacy) as unknown as Record<string, unknown>;

    for (const key of ["dailyReviewLimit", "seedStrategy", "seedSpreadDays", "requestRetention"]) {
      expect(result[key]).toBeUndefined();
    }
  });

  it("doesn't graft unrelated settings onto a track", () => {
    const { tracks } = withDefaults(legacy) as unknown as {
      tracks: Record<string, Record<string, unknown>>;
    };

    expect(tracks.leetcode!.providers).toBeUndefined();
    expect(tracks.leetcode!.tracks).toBeUndefined();
    expect(Object.keys(tracks.leetcode!).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS.tracks.leetcode).sort(),
    );
  });

  it("prefers an explicit per-track value over the old global one", () => {
    const half = {
      ...legacy,
      tracks: { neetcode: { dailyReviewLimit: 5 } },
    } as unknown as Partial<Settings>;

    const { tracks } = withDefaults(half);
    expect(tracks.neetcode.dailyReviewLimit).toBe(5);
    // The track with nothing stored still inherits the pre-split value.
    expect(tracks.leetcode.dailyReviewLimit).toBe(25);
  });

  it("defaults the newly added top-level fields", () => {
    const settings = withDefaults(legacy);

    expect(settings.activeTrack).toBe("neetcode");
    expect(settings.problemLinkTarget).toBe("track");
  });

  it("survives a round trip through itself", () => {
    // The stored value is always the output of a previous `withDefaults`, so applying it
    // twice has to be a no-op or settings would drift on every write.
    const once = withDefaults(legacy);
    expect(withDefaults(once)).toEqual(once);
  });
});

describe("the stale leetcode.enabled flag", () => {
  /**
   * What an install from before the LeetCode adapter has on disk. `enabled: false` was
   * the default then, and every settings write persisted it.
   */
  const preAdapter = {
    providers: {
      leetcode: {
        enabled: false,
        username: null,
        lastFullSyncAt: null,
        lastIncrementalSyncAt: null,
      },
      neetcode: {
        enabled: true,
        username: "curtis",
        lastFullSyncAt: 1_700_000_000_000,
        lastIncrementalSyncAt: 1_700_000_000_000,
      },
    },
  } as unknown as Partial<Settings>;

  it("turns LeetCode back on", () => {
    // Without this the sync is refused on every page load, so no LeetCode events are ever
    // ingested, so no LeetCode cards are ever seeded — the whole track stays empty.
    expect(withDefaults(preAdapter).providers.leetcode.enabled).toBe(true);
  });

  it("leaves everything else about the providers alone", () => {
    const { providers } = withDefaults(preAdapter);

    expect(providers.neetcode.username).toBe("curtis");
    expect(providers.neetcode.enabled).toBe(true);
    // The cursor is the one exception, cleared by the 2 -> 3 step below: an install this
    // old never ran the submission walk either.
    expect(providers.neetcode.lastFullSyncAt).toBeNull();
  });

  it("stamps the version so the correction happens once", () => {
    expect(withDefaults(preAdapter).settingsVersion).toBe(SETTINGS_VERSION);
  });

  it("respects a deliberate opt-out made after the migration", () => {
    // Once the toggle exists, `false` means what it says. Re-enabling on every read would
    // make the control impossible to use.
    const optedOut = {
      settingsVersion: SETTINGS_VERSION,
      providers: {
        ...DEFAULT_SETTINGS.providers,
        leetcode: { ...DEFAULT_SETTINGS.providers.leetcode, enabled: false },
      },
    } as Partial<Settings>;

    expect(withDefaults(optedOut).providers.leetcode.enabled).toBe(false);
  });

  it("doesn't resurrect the flag on a later read", () => {
    const migrated = withDefaults(preAdapter);
    const disabled = {
      ...migrated,
      providers: {
        ...migrated.providers,
        leetcode: { ...migrated.providers.leetcode, enabled: false },
      },
    };

    expect(withDefaults(disabled).providers.leetcode.enabled).toBe(false);
  });
});

describe("the shared NeetCode sync cursor", () => {
  /** An install whose cursor was set by completed-set reads, before the activity walk. */
  const preActivityWalk = {
    settingsVersion: 2,
    providers: {
      leetcode: { ...DEFAULT_SETTINGS.providers.leetcode },
      neetcode: {
        enabled: true,
        username: "curtis",
        lastFullSyncAt: 1_786_929_717_000,
        lastIncrementalSyncAt: 1_786_929_717_000,
      },
    },
  } as unknown as Partial<Settings>;

  it("clears the cursor so the history walk runs once in full", () => {
    // Sharing one cursor between the completed-set reads and the submission walk meant
    // the walk inherited a recent timestamp and only ever fetched the last day.
    const { providers } = withDefaults(preActivityWalk);

    expect(providers.neetcode.lastFullSyncAt).toBeNull();
    expect(providers.neetcode.lastIncrementalSyncAt).toBeNull();
  });

  it("keeps everything else about the provider", () => {
    const { providers } = withDefaults(preActivityWalk);

    expect(providers.neetcode.username).toBe("curtis");
    expect(providers.neetcode.enabled).toBe(true);
  });

  it("leaves LeetCode's cursor alone", () => {
    const stored = {
      ...preActivityWalk,
      providers: {
        ...(preActivityWalk as { providers: Settings["providers"] }).providers,
        leetcode: {
          enabled: true,
          username: null,
          lastFullSyncAt: 1_786_000_000_000,
          lastIncrementalSyncAt: 1_786_000_000_000,
        },
      },
    } as unknown as Partial<Settings>;

    // Only NeetCode had two surfaces sharing a cursor; re-walking LeetCode's history
    // would be minutes of requests for nothing.
    expect(withDefaults(stored).providers.leetcode.lastFullSyncAt).toBe(1_786_000_000_000);
  });

  it("doesn't clear it again once the walk has run", () => {
    const after = withDefaults(preActivityWalk);
    const synced = {
      ...after,
      providers: {
        ...after.providers,
        neetcode: { ...after.providers.neetcode, lastFullSyncAt: 1_787_000_000_000 },
      },
    };

    expect(withDefaults(synced).providers.neetcode.lastFullSyncAt).toBe(1_787_000_000_000);
  });
});

describe("where a problem opens", () => {
  it("follows the track being reviewed", () => {
    // The whole point of two tracks: a NeetCode review is a NeetCode problem, and a
    // LeetCode review is a LeetCode one. One fixed site collapses that distinction.
    expect(linkTargetFor("track", "neetcode")).toBe("neetcode");
    expect(linkTargetFor("track", "leetcode")).toBe("leetcode");
  });

  it("honours a pinned site whatever the track", () => {
    expect(linkTargetFor("leetcode", "neetcode")).toBe("leetcode");
    expect(linkTargetFor("neetcode", "leetcode")).toBe("neetcode");
  });
});

describe("the global NeetCode link target", () => {
  /** An install from before `"track"` existed, when NeetCode was the default. */
  const stored = (target: string, version: number) =>
    ({ settingsVersion: version, problemLinkTarget: target }) as unknown as Partial<Settings>;

  it("moves a stored NeetCode to following the track", () => {
    // Indistinguishable from never having opened the setting, since that value *was* the
    // default — so it carries no intent worth preserving over the better answer.
    expect(withDefaults(stored("neetcode", 3)).problemLinkTarget).toBe("track");
  });

  it("leaves a stored LeetCode alone", () => {
    // This one was never a default, so it can only have been chosen deliberately.
    expect(withDefaults(stored("leetcode", 3)).problemLinkTarget).toBe("leetcode");
  });

  it("stops correcting once the version is stamped", () => {
    // Otherwise picking "Always NeetCode" on the options page would be undone by the very
    // next read, and the radio would spring back on its own.
    const migrated = withDefaults(stored("neetcode", 3));
    const chosen = { ...migrated, problemLinkTarget: "neetcode" } as Settings;

    expect(chosen.settingsVersion).toBe(SETTINGS_VERSION);
    expect(withDefaults(chosen).problemLinkTarget).toBe("neetcode");
  });
});

describe("privacy consent", () => {
  it("starts unaccepted", () => {
    expect(hasAcceptedPrivacy(withDefaults(undefined))).toBe(false);
    expect(withDefaults(undefined).privacyAcceptedAt).toBeNull();
  });

  it("re-asks when the policy revision moves", () => {
    // The policy itself promises this. A promise in that document the code doesn't keep
    // is worse than no promise.
    const stale = {
      privacyAcceptedAt: 1_786_929_717_000,
      privacyAcceptedVersion: PRIVACY_POLICY_VERSION - 1,
    } as Partial<Settings>;

    expect(hasAcceptedPrivacy(withDefaults(stale))).toBe(false);
  });

  it("accepts the current revision", () => {
    const current = {
      privacyAcceptedAt: 1_786_929_717_000,
      privacyAcceptedVersion: PRIVACY_POLICY_VERSION,
    } as Partial<Settings>;

    expect(hasAcceptedPrivacy(withDefaults(current))).toBe(true);
  });

  it("treats a timestamp with no revision as unaccepted", () => {
    // Written by a build that predates versioning, so what was agreed to is unknown.
    const ambiguous = { privacyAcceptedAt: 1_786_929_717_000 } as Partial<Settings>;
    expect(hasAcceptedPrivacy(withDefaults(ambiguous))).toBe(false);
  });

  it("is never inferred for an existing install", () => {
    // Consent the code assumes on someone's behalf is not consent. An install that
    // predates the gate has to pass through it like any other.
    const existing = {
      settingsVersion: SETTINGS_VERSION,
      providers: DEFAULT_SETTINGS.providers,
      activeTrack: "leetcode",
    } as unknown as Partial<Settings>;

    expect(withDefaults(existing).privacyAcceptedAt).toBeNull();
  });

  it("keeps an acceptance once given", () => {
    const accepted = { privacyAcceptedAt: 1_786_929_717_000 } as Partial<Settings>;
    expect(withDefaults(accepted).privacyAcceptedAt).toBe(1_786_929_717_000);
  });

  it("survives a round trip", () => {
    const once = withDefaults({ privacyAcceptedAt: 123 } as Partial<Settings>);
    expect(withDefaults(once).privacyAcceptedAt).toBe(123);
  });
});

describe("carrying an acceptance across revisions", () => {
  const accepted = (version: number) =>
    withDefaults({
      privacyAcceptedAt: 1_786_929_717_000,
      privacyAcceptedVersion: version,
    } as Partial<Settings>);

  // Stands in for a future policy history. Only one revision exists today, so the
  // interesting cases have to be supplied rather than waited for.
  const revision = (version: number, carriesForward?: boolean): PrivacyRevision => ({
    version,
    effective: `revision ${version}`,
    sha256: `sha-${version}`,
    ...(carriesForward === undefined ? {} : { carriesForward }),
  });

  it("doesn't ask again for a revision declared minor", () => {
    const history = [revision(1), revision(2, true)];
    expect(hasAcceptedPrivacy(accepted(1), history)).toBe(true);
  });

  it("asks for a revision that was not declared minor", () => {
    // Omitting `carriesForward` is the whole safety property: forgetting to think about a
    // revision asks everybody rather than silently skipping them.
    const history = [revision(1), revision(2)];
    expect(hasAcceptedPrivacy(accepted(1), history)).toBe(false);
  });

  it("won't let a later minor revision smuggle a major one past", () => {
    // Accepted 1, then 2 changed something real and 3 only fixed wording. Checking every
    // revision in between is what catches this; a single threshold would not.
    const history = [revision(1), revision(2), revision(3, true)];
    expect(hasAcceptedPrivacy(accepted(1), history)).toBe(false);
  });

  it("carries across a run of minor revisions", () => {
    const history = [revision(1), revision(2, true), revision(3, true)];
    expect(hasAcceptedPrivacy(accepted(1), history)).toBe(true);
  });

  it("never carries a first acceptance that was never given", () => {
    // A minor first revision must not stand in for an acceptance nobody made.
    expect(hasAcceptedPrivacy(withDefaults(undefined), [revision(1, true)])).toBe(false);
  });

  it("reads the live revisions when none are passed", () => {
    expect(hasAcceptedPrivacy(accepted(PRIVACY_POLICY_VERSION))).toBe(true);
    expect(hasAcceptedPrivacy(accepted(PRIVACY_POLICY_VERSION - 1))).toBe(false);
  });

  it("forgets a stored opt-out from the build that offered one", () => {
    // Shipped briefly as `privacyAutoAcceptUpdates`. The decision is ours per revision
    // now, so a stale stored preference must not survive the merge and mean anything.
    const stale = { privacyAcceptedVersion: 1, privacyAutoAcceptUpdates: true } as Partial<Settings>;
    expect(withDefaults(stale)).not.toHaveProperty("privacyAutoAcceptUpdates");
  });
});

describe("settingsWithoutConsent", () => {
  it("drops the acceptance record and nothing else", () => {
    const accepted: Settings = {
      ...DEFAULT_SETTINGS,
      privacyAcceptedAt: 1_700_000_000_000,
      privacyAcceptedVersion: 1,
      activeTrack: "leetcode",
    };

    const stripped = settingsWithoutConsent(accepted);

    expect(stripped).not.toHaveProperty("privacyAcceptedAt");
    expect(stripped).not.toHaveProperty("privacyAcceptedVersion");
    expect(stripped.activeTrack).toBe("leetcode");
    expect(stripped.tracks).toEqual(accepted.tracks);
    expect(stripped.providers).toEqual(accepted.providers);
  });

  it("merges over current settings without touching acceptance", () => {
    // How both stores apply an import: everything from the file, consent from here.
    const local: Settings = { ...DEFAULT_SETTINGS, privacyAcceptedAt: 1, privacyAcceptedVersion: 1 };
    const imported: Settings = {
      ...DEFAULT_SETTINGS,
      privacyAcceptedAt: 999,
      privacyAcceptedVersion: 7,
      activeTrack: "leetcode",
    };

    const merged = withDefaults({ ...local, ...settingsWithoutConsent(imported) });

    expect(merged.privacyAcceptedAt).toBe(1);
    expect(merged.privacyAcceptedVersion).toBe(1);
    expect(merged.activeTrack).toBe("leetcode");
  });
});
