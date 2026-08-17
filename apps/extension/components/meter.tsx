import type { ReactNode } from "react";

import { cx } from "./cx";

export type MeterTone = "accent" | "good" | "warn" | "danger" | "info";

const FILLS: Record<MeterTone, string> = {
  accent: "bg-accent",
  good: "bg-good-solid",
  warn: "bg-warn-solid",
  danger: "bg-danger-solid",
  info: "bg-info-solid",
};

export interface MeterProps {
  value: number;
  max: number;
  /** Left-hand caption, e.g. "Reviewed today". */
  label?: ReactNode;
  /** Right-hand caption. Defaults to "value of max". */
  valueLabel?: ReactNode;
  tone?: MeterTone;
  /** Switch to `good` automatically once the bar is full. Default true. */
  completeTone?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * "N of M done" as a bar. Progress is the one number in this app that people read
 * at a glance, so it gets a shape rather than a sentence.
 */
export function Meter({
  value,
  max,
  label,
  valueLabel,
  tone = "accent",
  completeTone = true,
  size = "md",
  className,
}: MeterProps) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  const done = max > 0 && clamped >= max;
  const fill = FILLS[done && completeTone ? "good" : tone];

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label != null || valueLabel !== undefined ? (
        <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-ink-muted">{label}</span>
          <span className="shrink-0 font-semibold tabular-nums text-ink">
            {valueLabel ?? `${clamped} of ${max}`}
          </span>
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={typeof label === "string" ? label : "Progress"}
        className={cx(
          "w-full overflow-hidden rounded-full bg-surface-sunken",
          size === "sm" ? "h-1" : "h-1.5",
        )}
      >
        <div
          className={cx("h-full rounded-full transition-[width] duration-300", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
