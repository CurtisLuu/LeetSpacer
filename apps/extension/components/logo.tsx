import { cx } from "./cx";

/**
 * The LeetSpacer mark: two stacked cards — a deck, which is what a review schedule is —
 * with braces on the face for the code.
 *
 * Colours are hard-coded rather than themed. A logo is the one thing in the interface that
 * should look identical everywhere, and the pale face reads on both surfaces because the
 * purple card behind it supplies the edge.
 *
 * Geometry matches `scripts/build-icons.py`, which renders the same mark to PNG for the
 * toolbar. Change one and change the other.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cx("shrink-0", className)}
      role="img"
      aria-label="LeetSpacer"
    >
      <rect
        x="6.64"
        y="4.72"
        width="19.84"
        height="23.2"
        rx="3.47"
        fill="#c4b5fd"
        transform="rotate(6 16.56 16.32)"
      />
      <rect x="5.52" y="4.08" width="19.84" height="23.2" rx="3.47" fill="#e7e9f0" />
      {/* Two copies of one brace path; the closing one is the same curve mirrored. */}
      <g fill="none" stroke="#a78bfa" strokeWidth="1.19" strokeLinecap="round" strokeLinejoin="round">
        <path d={BRACE} transform="translate(9.98 9.42)" />
        <path d={BRACE} transform="translate(20.9 9.42) scale(-1 1)" />
      </g>
    </svg>
  );
}

/** An opening brace, drawn once and mirrored for the closing one. */
const BRACE =
  "M3.97 0 C2.46 0 2.46 0.38 2.46 2.13 L2.46 4.26 C2.46 5.51 1.11 6.27 0 6.27 " +
  "C1.11 6.27 2.46 7.02 2.46 8.27 L2.46 10.4 C2.46 12.15 2.46 12.53 3.97 12.53";

/**
 * The wordmark, set two-tone the way the artwork does it.
 *
 * The original ghosts "Leet" almost to white, which works on a poster and disappears in a
 * user interface — so it uses the muted ink token instead. Same idea, still legible, and
 * it survives dark mode, which a fixed near-white would not.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-semibold tracking-tight", className)}>
      <span className="text-ink-subtle">Leet</span>
      <span className="text-accent">Spacer</span>
    </span>
  );
}
