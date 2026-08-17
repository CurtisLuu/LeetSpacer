import { TRACK_IDS, type TrackId } from "@lcs/core";

import { cx } from "./cx";

export const TRACK_LABELS: Record<TrackId, string> = {
  leetcode: "LeetCode",
  neetcode: "NeetCode",
};

export interface TrackSwitcherProps {
  value: TrackId;
  onChange: (track: TrackId) => void;
  /** Reviews waiting in each track, shown as a count on the inactive tab. */
  due?: Record<TrackId, number>;
  disabled?: boolean;
  className?: string;
}

/**
 * The selector that decides which schedule the whole UI is showing.
 *
 * A segmented control rather than a dropdown: there are exactly two options, both worth
 * seeing at once, and the count on the track you're *not* in is the main reason to switch.
 *
 * Implemented as a radiogroup so arrow keys move between tracks the way a native tab strip
 * does, and so screen readers announce it as one control with two states rather than two
 * unrelated buttons.
 */
export function TrackSwitcher({
  value,
  onChange,
  due,
  disabled = false,
  className,
}: TrackSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Practice track"
      className={cx(
        "flex w-full gap-1 rounded-xl border border-border bg-surface p-1",
        className,
      )}
    >
      {TRACK_IDS.map((track) => {
        const active = track === value;
        const waiting = due?.[track] ?? 0;

        return (
          <button
            key={track}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            // Only the selected tab stays in the tab order; arrow keys move within the
            // group. Roving tabindex is what makes a radiogroup behave like one control.
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = TRACK_IDS[(TRACK_IDS.indexOf(value) + 1) % TRACK_IDS.length];
              if (next) onChange(next);
            }}
            onClick={() => onChange(track)}
            className={cx(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5",
              "text-xs font-medium transition-colors duration-100",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active
                ? "bg-accent-soft text-accent shadow-sm"
                : "text-ink-muted hover:bg-surface-raised hover:text-ink",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="truncate">{TRACK_LABELS[track]}</span>
            {waiting > 0 ? (
              <span
                className={cx(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums",
                  active ? "bg-accent/20 text-accent" : "bg-border text-ink-muted",
                )}
              >
                {waiting > 99 ? "99+" : waiting}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
