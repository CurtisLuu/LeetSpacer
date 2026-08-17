import type { ReactNode } from "react";

import { cx } from "./cx";

export type CalloutTone = "neutral" | "info" | "good" | "warn" | "danger";

const TONES: Record<CalloutTone, { box: string; mark: string }> = {
  neutral: { box: "border-border bg-surface-raised text-ink-muted", mark: "bg-ink-subtle" },
  info: { box: "border-info/30 bg-info-soft text-info", mark: "bg-info-solid" },
  good: { box: "border-good/30 bg-good-soft text-good", mark: "bg-good-solid" },
  warn: { box: "border-warn/30 bg-warn-soft text-warn", mark: "bg-warn-solid" },
  danger: { box: "border-danger/30 bg-danger-soft text-danger", mark: "bg-danger-solid" },
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** Optional bold first line. */
  title?: ReactNode;
  /** Trailing control, e.g. a retry button. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * Inline feedback: sync results, import errors, permission refusals. One shape for
 * all of them, so the colour is the only thing the eye has to decode.
 */
export function Callout({ tone = "neutral", title, action, className, children }: CalloutProps) {
  const style = TONES[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
        style.box,
        className,
      )}
    >
      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", style.mark)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title != null ? <p className="font-semibold">{title}</p> : null}
        {children != null ? <div className="min-w-0">{children}</div> : null}
      </div>
      {action != null ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
