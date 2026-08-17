import type { Difficulty } from "@lcs/core";
import type { ReactNode } from "react";

import { titleFromSlug } from "../lib/format";
import { cx } from "./cx";

/**
 * Tones are named after what they mean, not what colour they are, so a palette
 * change never has to touch a component.
 */
export type BadgeTone =
  | "neutral"
  | "accent"
  | "good"
  | "warn"
  | "danger"
  | "info"
  | "difficulty-easy"
  | "difficulty-medium"
  | "difficulty-hard"
  | "grade-again"
  | "grade-hard"
  | "grade-good"
  | "grade-easy"
  | "urgency-high"
  | "urgency-medium"
  | "urgency-low";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  "difficulty-easy": "bg-difficulty-easy-soft text-difficulty-easy",
  "difficulty-medium": "bg-difficulty-medium-soft text-difficulty-medium",
  "difficulty-hard": "bg-difficulty-hard-soft text-difficulty-hard",
  "grade-again": "bg-grade-again-soft text-grade-again",
  "grade-hard": "bg-grade-hard-soft text-grade-hard",
  "grade-good": "bg-grade-good-soft text-grade-good",
  "grade-easy": "bg-grade-easy-soft text-grade-easy",
  "urgency-high": "bg-urgency-high-soft text-urgency-high",
  "urgency-medium": "bg-urgency-medium-soft text-urgency-medium",
  "urgency-low": "bg-urgency-low-soft text-urgency-low",
};

export type BadgeSize = "sm" | "md";

// 12px is the floor: below that the uppercase-ish chip text stops being readable
// against a tint at side-panel distances.
const SIZES: Record<BadgeSize, string> = {
  sm: "h-5 gap-1 px-1.5 text-[0.75rem]",
  md: "h-6 gap-1.5 px-2 text-xs",
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** A filled circle in the current colour — for status rather than category. */
  dot?: boolean;
  /** Hairline border in the tone colour. Helps chips read on tinted cards. */
  outline?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

/** A small, self-contained label. Never wraps; truncates if the panel is narrow. */
export function Badge({
  tone = "neutral",
  size = "sm",
  dot = false,
  outline = false,
  title,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex min-w-0 max-w-full shrink-0 items-center rounded-full font-semibold",
        "whitespace-nowrap tracking-tight",
        SIZES[size],
        TONES[tone],
        outline && "border border-current/25",
        className,
      )}
    >
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

const DIFFICULTY_TONES: Record<Difficulty, BadgeTone> = {
  Easy: "difficulty-easy",
  Medium: "difficulty-medium",
  Hard: "difficulty-hard",
};

export interface DifficultyBadgeProps {
  difficulty: Difficulty | null | undefined;
  size?: BadgeSize;
  /** Render "E"/"M"/"H" instead of the full word — for very dense rows. */
  short?: boolean;
  className?: string;
}

/** Renders nothing when the catalog has no difficulty for the slug. */
export function DifficultyBadge({
  difficulty,
  size = "sm",
  short = false,
  className,
}: DifficultyBadgeProps) {
  if (!difficulty) return null;

  return (
    <Badge
      tone={DIFFICULTY_TONES[difficulty]}
      size={size}
      title={`${difficulty} problem`}
      className={className}
    >
      {short ? difficulty.charAt(0) : difficulty}
    </Badge>
  );
}

export interface TopicChipProps {
  /** A LeetCode topic tag slug, e.g. `hash-table`. */
  topic: string;
  size?: BadgeSize;
}

/** Quiet by design: topics are context, not signal. */
export function TopicChip({ topic, size = "sm" }: TopicChipProps) {
  return (
    <Badge tone="neutral" size={size} className="font-medium">
      {titleFromSlug(topic)}
    </Badge>
  );
}

export interface DueBadgeProps {
  /** Positive means overdue, negative means scheduled for the future. */
  overdueDays: number;
  size?: BadgeSize;
}

/**
 * Turns the raw number into the two things the user actually wants: how late it
 * is, and how much that matters. A week late is red; tomorrow is quiet.
 */
export function DueBadge({ overdueDays, size = "sm" }: DueBadgeProps) {
  const { tone, label, title } = describeDue(overdueDays);
  return (
    <Badge tone={tone} size={size} title={title} dot={tone === "urgency-high"}>
      {label}
    </Badge>
  );
}

export function describeDue(overdueDays: number): {
  tone: BadgeTone;
  label: string;
  title: string;
} {
  const days = Math.round(overdueDays);

  if (days >= 7) {
    return {
      tone: "urgency-high",
      label: days >= 30 ? `${Math.round(days / 30)}mo late` : `${Math.round(days / 7)}w late`,
      title: `${days} days overdue`,
    };
  }
  if (days >= 1) {
    return { tone: "urgency-high", label: `${days}d late`, title: `${days} days overdue` };
  }
  if (days === 0) {
    return { tone: "urgency-medium", label: "due today", title: "Scheduled for today" };
  }

  const ahead = Math.abs(days);
  return {
    tone: "urgency-low",
    label: ahead === 1 ? "due tomorrow" : `in ${ahead}d`,
    title: `Due in ${ahead} day${ahead === 1 ? "" : "s"}`,
  };
}
