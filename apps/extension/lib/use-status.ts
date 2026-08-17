import { useCallback, useEffect, useState } from "react";

import { type SyncStatus, send } from "./messaging.js";

/** Polls the background for sync status. Cheap enough to refresh whenever a panel opens. */
export function useStatus(pollMs = 5_000) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await send("sync:status", {}));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { status, error, refresh };
}
