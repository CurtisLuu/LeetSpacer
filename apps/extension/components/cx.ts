/** Join class names, dropping anything falsy. Keeps variant maps readable. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The one focus treatment components opt into explicitly.
 *
 * `assets/tailwind.css` also sets a global `:focus-visible` outline, so this is
 * belt-and-braces: it survives any component that needs its own outline colour.
 */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
