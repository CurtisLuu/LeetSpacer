import { useCallback, useEffect, useState } from "react";

import { PRIVACY_POLICY_VERSION, hasAcceptedPrivacy } from "@lcs/core";

import { send } from "./messaging.js";

/**
 * Whether the privacy policy has been accepted.
 *
 * `null` while unknown, so the interface can hold rather than flashing a consent screen at
 * someone who accepted months ago.
 */
export function useConsent(): {
  accepted: boolean | null;
  /**
   * Record acceptance of the policy as it currently stands.
   *
   * `autoAcceptUpdates` carries that acceptance forward over later revisions instead of
   * re-presenting them — the "don't ask me again" tick. It never covers a revision that
   * expands what is read; see `PRIVACY_FORCED_REACCEPT_VERSION`.
   */
  accept: (autoAcceptUpdates?: boolean) => void;
} {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void send("settings:get", {})
      .then((settings) => {
        if (!cancelled) setAccepted(hasAcceptedPrivacy(settings));
      })
      .catch(() => {
        // Unknown is not consent. Holding is the safe direction.
        if (!cancelled) setAccepted(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback((autoAcceptUpdates = false) => {
    setAccepted(true);
    void send("settings:update", {
      patch: {
        privacyAcceptedAt: Date.now(),
        privacyAcceptedVersion: PRIVACY_POLICY_VERSION,
        // Written on every accept, including `false`, so unticking the box on a
        // re-presented revision actually withdraws the earlier standing permission
        // rather than leaving it set from last time.
        privacyAutoAcceptUpdates: autoAcceptUpdates,
      },
    }).catch(() => {
      setAccepted(false);
    });
  }, []);

  return { accepted, accept };
}
