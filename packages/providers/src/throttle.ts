/**
 * Minimum spacing between an adapter's network round trips.
 *
 * Every adapter awaits this before each request. It exists so a full sync reads like a
 * person browsing rather than a scraper, which is both the polite thing to do and a
 * condition of not getting the user's own session rate-limited.
 */
export function createThrottle(minIntervalMs: number, jitterMs = 0): () => Promise<void> {
  let nextAllowedAt = 0;

  return async () => {
    const now = Date.now();
    const wait = Math.max(0, nextAllowedAt - now);
    const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
    nextAllowedAt = now + wait + minIntervalMs + jitter;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}
