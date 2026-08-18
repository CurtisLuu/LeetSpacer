/**
 * Display helpers.
 *
 * Titles are derived from the slug rather than looked up, because NeetCode uses its own
 * slugs (`is-anagram`, `buy-and-sell-crypto`) that don't match LeetCode's, so the bundled
 * catalog can't resolve them yet. See docs/providers.md.
 */

/** Words that read better lowercase, and initialisms that should stay uppercase. */
const LOWERCASE = new Set(["a", "an", "and", "for", "in", "of", "or", "the", "to", "with"]);
const UPPERCASE = new Set(["bst", "ii", "iii", "iv", "lru", "lfu", "dfs", "bfs", "api", "2d", "3d"]);

export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word, index) => {
      if (UPPERCASE.has(word)) return word.toUpperCase();
      if (index > 0 && LOWERCASE.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** "3 days ago", "today" — short enough for a dense list. */
export function relativeDays(days: number): string {
  const rounded = Math.round(Math.abs(days));
  if (rounded === 0) return "today";
  if (rounded === 1) return "1 day";
  if (rounded < 30) return `${rounded} days`;
  const months = Math.round(rounded / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

/**
 * How long until a card unlocks, at the coarsest useful precision.
 *
 * Seconds only under a minute, then minutes, hours, days. A learning-step card comes
 * back in six minutes and a mature one in eight months, and the same string has to carry
 * both without turning into "0.004 months".
 */
export function formatCountdown(msUntilDue: number): string {
  if (msUntilDue <= 0) return "due now";

  const seconds = Math.ceil(msUntilDue / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  // Rounds rather than ceils from here up: "2h" is a better answer than "3h" for
  // something 2 hours and 5 minutes away.
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${Math.max(1, hours)}h`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${Math.max(1, days)}d`;

  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo` : `${Math.round(months / 12)}y`;
}

/** True when a card is close enough that a live-ticking timer is worth showing. */
export function isImminent(msUntilDue: number): boolean {
  return msUntilDue > 0 && msUntilDue < 60 * 60 * 1000;
}

/**
 * "later today" / "tomorrow" / "Thursday" / "18 Aug" — the shortest unambiguous form.
 *
 * Counted in calendar days from local midnight, not in 24-hour blocks. Rounding the
 * difference in milliseconds called anything inside a day "tomorrow", so a card coming
 * back at nine tonight was announced as tomorrow's — and "today" already means midnight
 * to midnight everywhere else in the app, including the reviewed-today count.
 */
export function formatDueDate(at: number, now: number = Date.now()): string {
  const days = calendarDaysBetween(now, at);
  if (days <= 0) return at <= now ? "now" : "later today";
  if (days === 1) return "tomorrow";
  if (days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Whole days between the local midnights either timestamp falls in. */
function calendarDaysBetween(from: number, to: number): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  // Rounded, not floored: a DST boundary makes one of these days 23 or 25 hours long.
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
