import { useCallback, useEffect, useState } from "react";

import { send } from "./messaging.js";

/**
 * Whether the privacy policy has been accepted.
 *
 * `null` while unknown, so the interface can hold rather than flashing a consent screen at
 * someone who accepted months ago.
 */
export function useConsent(): {
  accepted: boolean | null;
  accept: () => void;
} {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void send("settings:get", {})
      .then((settings) => {
        if (!cancelled) setAccepted(settings.privacyAcceptedAt !== null);
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
    void send("settings:update", { patch: { privacyAcceptedAt: Date.now() } }).catch(() => {
      setAccepted(false);
    });
  }, []);

  return { accepted, accept };
}
