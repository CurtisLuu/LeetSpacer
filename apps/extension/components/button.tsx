import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { FOCUS_RING, cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const BASE = cx(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold",
  "whitespace-nowrap select-none transition-colors duration-100",
  // Buttons live in flex rows that must be allowed to shrink rather than overflow.
  "min-w-0 max-w-full",
  "disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
  FOCUS_RING,
);

const VARIANTS: Record<ButtonVariant, string> = {
  primary: cx(
    "bg-accent text-accent-ink shadow-sm",
    "hover:not-disabled:bg-accent-strong active:not-disabled:bg-accent-strong",
  ),
  secondary: cx(
    "border border-border bg-surface-raised text-ink",
    "hover:not-disabled:border-border-strong hover:not-disabled:bg-surface-sunken",
  ),
  ghost: cx(
    "border border-transparent text-ink-muted",
    "hover:not-disabled:bg-surface-raised hover:not-disabled:text-ink",
  ),
  danger: cx(
    "border border-danger/35 bg-danger-soft text-danger",
    "hover:not-disabled:border-danger/60",
  ),
  // Reads as a link but behaves as a button — for "Settings", "Cancel paste" and
  // other inline actions that shouldn't compete with a real button.
  link: cx(
    "font-medium text-accent underline decoration-accent/40 underline-offset-2",
    "hover:not-disabled:decoration-accent",
  ),
};

// Heights are explicit so a row of mixed buttons always lines up, and every hit
// target clears 28px even at the smallest size.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-xs",
  lg: "h-9 px-3.5 text-sm",
};

const LINK_SIZES: Record<ButtonSize, string> = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-sm",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the width of the container. */
  block?: boolean;
  className?: string;
}

/**
 * The class string on its own, for the odd element that can't be a `Button` —
 * a `<label>` acting as a file picker, say.
 */
export function buttonClass({
  variant = "secondary",
  size = "md",
  block = false,
  className,
}: ButtonStyleOptions = {}): string {
  if (variant === "link") {
    return cx(
      "inline-flex items-center gap-1 rounded-sm",
      LINK_SIZES[size],
      VARIANTS.link,
      "disabled:cursor-not-allowed disabled:opacity-55",
      FOCUS_RING,
      block && "w-full justify-center",
      className,
    );
  }

  return cx(BASE, SIZES[size], VARIANTS[variant], block && "w-full", className);
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">,
    ButtonStyleOptions {
  /** Shows a spinner, disables the button and marks it `aria-busy`. */
  busy?: boolean;
  /** Rendered before the label. Inline SVG only — there is no icon dependency. */
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant,
  size,
  block,
  className,
  busy = false,
  icon,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={buttonClass({ variant, size, block, className })}
    >
      {busy ? <Spinner /> : icon}
      {children != null ? <span className="truncate">{children}</span> : null}
    </button>
  );
}

export interface ButtonLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className">,
    ButtonStyleOptions {
  icon?: ReactNode;
  children?: ReactNode;
}

/** Same shapes as `Button`, for anchors that open a page. */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  icon,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a {...rest} className={buttonClass({ variant, size, block, className })}>
      {icon}
      {children != null ? <span className="truncate">{children}</span> : null}
    </a>
  );
}

function Spinner() {
  return (
    <svg
      className="size-3.5 shrink-0 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
