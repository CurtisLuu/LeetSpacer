import type { TrackId } from "@lcs/core";
import { useCallback, useEffect, useState } from "react";

import { send } from "./messaging.js";

/**
 * The track the UI is showing, persisted in settings.
 *
 * Persisted rather than held in component state because the choice has to outlive the
 * panel: the side panel is torn down whenever it closes, and the badge — which the
 * background paints — has to agree with whatever the panel will show when it reopens.
 *
 * Updates optimistically. Switching tracks re-renders a whole queue, and waiting for a
 * storage round trip before the tab even highlights makes the control feel broken.
 */
export function useTrack(): {
  track: TrackId | null;
  setTrack: (track: TrackId) => void;
} {
  const [track, setLocal] = useState<TrackId | null>(null);

  useEffect(() => {
    let cancelled = false;
    void send("settings:get", {})
      .then((settings) => {
        if (!cancelled) setLocal(settings.activeTrack);
      })
      .catch(() => {
        // The panel is more useful showing *a* track than an error. NeetCode is the
        // default track, so falling back to it matches a fresh install.
        if (!cancelled) setLocal("neetcode");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTrack = useCallback((next: TrackId) => {
    setLocal(next);
    void send("settings:update", { patch: { activeTrack: next } }).catch(() => {});
  }, []);

  return { track, setTrack };
}
