import type { ReactNode } from "react";

import type { ProviderStatus } from "../lib/messaging.js";
import { Badge } from "./badge";
import { ButtonLink } from "./button";
import { cx } from "./cx";

export * from "./badge";
export * from "./button";
export * from "./callout";
export * from "./cx";
export * from "./field";
export * from "./grade-button";
export * from "./meter";
export * from "./tooltip";
export * from "./track-switcher";

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export type CardTone = "default" | "accent" | "good" | "warn" | "danger" | "muted";

const CARD_TONES: Record<CardTone, string> = {
  default: "border-border bg-surface-raised",
  accent: "border-accent/30 bg-accent-soft",
  good: "border-good/30 bg-good-soft",
  warn: "border-warn/30 bg-warn-soft",
  danger: "border-danger/30 bg-danger-soft",
  muted: "border-border bg-surface",
};

export interface CardProps {
  tone?: CardTone;
  /** `li` when the card is a row in a list. */
  as?: "div" | "li" | "section";
  /** Adds hover feedback. Use only when the whole card is interactive. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}

/** The one raised surface. Everything boxed in this app is a Card. */
export function Card({
  tone = "default",
  as: Tag = "div",
  interactive = false,
  className,
  children,
}: CardProps) {
  return (
    <Tag
      className={cx(
        "min-w-0 rounded-xl border p-3",
        CARD_TONES[tone],
        interactive && "transition-colors duration-100 hover:border-border-strong",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/* Existing exports — same required props, new optional ones                   */
/* -------------------------------------------------------------------------- */

export type StatTone = "neutral" | "accent" | "good" | "warn" | "danger" | "info";

const STAT_TONES: Record<StatTone, { value: string; rail: string }> = {
  neutral: { value: "text-ink", rail: "bg-border-strong" },
  accent: { value: "text-accent", rail: "bg-accent" },
  good: { value: "text-good", rail: "bg-good-solid" },
  warn: { value: "text-warn", rail: "bg-warn-solid" },
  danger: { value: "text-danger", rail: "bg-danger-solid" },
  info: { value: "text-info", rail: "bg-info-solid" },
};

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Colours the number and its rail. Default `neutral`. */
  tone?: StatTone;
  /** Tooltip on the whole tile — room for the long version of the label. */
  hint?: string;
  className?: string;
}

/**
 * One number and what it counts.
 *
 * Sized to survive a three-across grid in a 300px panel: the label truncates, the
 * number never does, and a coloured rail carries the meaning when the tile is too
 * small to read at a glance.
 */
export function Stat({ label, value, tone = "neutral", hint, className }: StatProps) {
  const style = STAT_TONES[tone];

  return (
    <div
      title={hint}
      className={cx(
        "flex min-w-0 items-stretch gap-2 overflow-hidden rounded-xl border border-border bg-surface-raised",
        className,
      )}
    >
      <span className={cx("w-1 shrink-0 rounded-full", style.rail)} aria-hidden="true" />
      <div className="min-w-0 py-2 pr-2.5">
        <div className={cx("truncate text-lg font-semibold tabular-nums", style.value)}>
          {value}
        </div>
        <div className="truncate text-[0.75rem] font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </div>
      </div>
    </div>
  );
}

export interface SectionProps {
  title: string;
  children: ReactNode;
  /** Right-aligned control on the header row, e.g. a refresh button. */
  action?: ReactNode;
  /** A count or state chip next to the title. */
  badge?: ReactNode;
  /** One quiet line under the title. */
  description?: ReactNode;
  className?: string;
}

/** A titled block. The heading is the only place uppercase micro-type is used. */
export function Section({
  title,
  children,
  action,
  badge,
  description,
  className,
}: SectionProps) {
  return (
    <section className={cx("min-w-0 space-y-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {title}
          </h2>
          {badge}
        </div>
        {action != null ? <div className="shrink-0">{action}</div> : null}
      </div>

      {description != null ? (
        <p className="text-xs text-ink-subtle">{description}</p>
      ) : null}

      {children}
    </section>
  );
}

const PROVIDER_LABELS: Record<string, { name: string; url: string }> = {
  leetcode: { name: "LeetCode", url: "https://leetcode.com/problemset/" },
  neetcode: { name: "NeetCode", url: "https://neetcode.io/practice" },
};

export function ProviderCard({ status }: { status: ProviderStatus }) {
  const label = PROVIDER_LABELS[status.provider] ?? { name: status.provider, url: "#" };

  return (
    <Card>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 truncate font-semibold text-ink">{label.name}</span>
        <Badge tone={status.connected ? "good" : "neutral"} dot>
          {status.connected ? "connected" : "no tab open"}
        </Badge>
      </div>

      {status.username ? (
        <p className="mt-1 truncate text-xs text-ink-subtle">@{status.username}</p>
      ) : null}

      <p className="mt-1 text-xs text-ink-muted">
        {status.lastFullSyncAt
          ? `Last full sync ${new Date(status.lastFullSyncAt).toLocaleString()}`
          : "Never synced."}
      </p>

      {status.lastError ? (
        <p className="mt-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">
          {status.lastError}
        </p>
      ) : null}

      {!status.connected ? (
        <ButtonLink
          className="mt-2"
          size="sm"
          variant="secondary"
          href={label.url}
          target="_blank"
          rel="noreferrer"
          icon={<ExternalIcon />}
        >
          Open {label.name}
        </ButtonLink>
      ) : null}
    </Card>
  );
}

export interface EmptyProps {
  title: string;
  body: string;
  /** Replaces the default check mark. Inline SVG or an emoji-free glyph. */
  icon?: ReactNode;
  /** A single call to action under the copy. */
  action?: ReactNode;
  /** `good` for "you're done", `neutral` for "nothing here yet". Default `good`. */
  tone?: "good" | "neutral";
}

/** The end of the queue. Deliberately a reward, not an error. */
export function Empty({ title, body, icon, action, tone = "good" }: EmptyProps) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col items-center rounded-xl border border-dashed p-4 text-center",
        tone === "good" ? "border-good/40 bg-good-soft" : "border-border bg-surface-raised",
      )}
    >
      <span
        className={cx(
          "mb-2 flex size-8 items-center justify-center rounded-full",
          tone === "good" ? "bg-good-soft text-good" : "bg-surface-sunken text-ink-subtle",
        )}
        aria-hidden="true"
      >
        {icon ?? <CheckIcon />}
      </span>
      <p className={cx("font-semibold", tone === "good" ? "text-good" : "text-ink")}>{title}</p>
      <p className="mt-1 text-xs text-ink-muted">{body}</p>
      {action != null ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons — inline only; the extension CSP forbids remote assets                */
/* -------------------------------------------------------------------------- */

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cx("size-4", className)}
    >
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cx("size-3.5 shrink-0", className)}
    >
      <path
        d="M6.5 3.5H3.5v9h9v-3M9.5 3.5h3v3M12.5 3.5 7 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
