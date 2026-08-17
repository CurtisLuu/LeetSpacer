import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * A hover/focus label.
 *
 * The native `title` attribute takes about a second to appear, can't be styled, and never
 * shows for keyboard users. This is CSS-only — no positioning library, no state — and
 * triggers on `focus-within` as well as hover so tabbing reveals the same explanation.
 *
 * Deliberately `pointer-events-none`: the bubble can never sit between the cursor and the
 * thing being pointed at.
 */
export type TooltipSide = "top" | "bottom";

export interface TooltipProps {
  /** Kept short — this is a hint, not documentation. */
  label: ReactNode;
  side?: TooltipSide;
  /** Aligns the bubble's edge to the trigger. Use at the panel's edges to avoid clipping. */
  align?: "center" | "start" | "end";
  className?: string;
  children: ReactNode;
}

const SIDES: Record<TooltipSide, string> = {
  top: "bottom-full mb-1.5",
  bottom: "top-full mt-1.5",
};

const ALIGN: Record<NonNullable<TooltipProps["align"]>, string> = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
};

export function Tooltip({
  label,
  side = "top",
  align = "center",
  className,
  children,
}: TooltipProps) {
  return (
    <span className={cx("group/tip relative inline-flex min-w-0", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-30 w-max max-w-[13rem] rounded-md px-2 py-1",
          "border border-border-strong bg-surface-sunken text-xs font-normal text-ink shadow-lg",
          "opacity-0 transition-opacity duration-100",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          SIDES[side],
          ALIGN[align],
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * A quiet "?" that explains the thing next to it. Focusable, so the tooltip is reachable
 * without a mouse.
 */
export function InfoDot({ label, side, align }: Omit<TooltipProps, "children" | "className">) {
  return (
    <Tooltip label={label} side={side} align={align}>
      <button
        type="button"
        aria-label="More information"
        className={cx(
          "flex size-4 shrink-0 items-center justify-center rounded-full",
          "border border-border-strong text-[0.625rem] font-semibold leading-none text-ink-muted",
          "transition-colors hover:border-accent hover:text-accent",
        )}
      >
        ?
      </button>
    </Tooltip>
  );
}
