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
