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
  /** Record acceptance of the policy as it currently stands. */
  accept: () => void;
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

  const accept = useCallback(() => {
    setAccepted(true);
    void send("settings:update", {
      patch: { privacyAcceptedAt: Date.now(), privacyAcceptedVersion: PRIVACY_POLICY_VERSION },
    }).catch(() => {
      setAccepted(false);
    });
  }, []);

  return { accepted, accept };
}
