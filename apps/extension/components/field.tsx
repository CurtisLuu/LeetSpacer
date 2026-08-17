import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { useId } from "react";

import { FOCUS_RING, cx } from "./cx";

/** The shared input shell — border, layer, radius, focus. */
export function inputClass(className?: string): string {
  return cx(
    "w-full min-w-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink",
    "placeholder:text-ink-subtle",
    "hover:border-border-strong",
    "disabled:cursor-not-allowed disabled:opacity-55",
    FOCUS_RING,
    className,
  );
}

export interface FieldProps {
  label: ReactNode;
  /** Explanatory line under the control. */
  hint?: ReactNode;
  /** Turns the whole field red and announces the message. */
  error?: string | null;
  /** Right-aligned value readout, e.g. the live percentage on a slider. */
  value?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}

/**
 * Label + control + hint, wired together. The child is a function so the control
 * keeps its own props while still getting the generated id.
 */
export function Field({ label, hint, error, value, className, children }: FieldProps) {
  const id = useId();

  return (
    <div className={cx("min-w-0 space-y-1", className)}>
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <label htmlFor={id} className="min-w-0 truncate text-xs font-medium text-ink-muted">
          {label}
        </label>
        {value != null ? (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">{value}</span>
        ) : null}
      </div>

      {children(id)}

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint != null ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  className?: string;
  /** Monospace, for repository names and tokens. */
  mono?: boolean;
  invalid?: boolean;
}

export function TextInput({ className, mono = false, invalid = false, ...rest }: TextInputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={inputClass(
        cx(mono && "font-mono text-xs", invalid && "border-danger", className),
      )}
    />
  );
}

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  className?: string;
  mono?: boolean;
}

export function TextArea({ className, mono = false, ...rest }: TextAreaProps) {
  return (
    <textarea {...rest} className={inputClass(cx(mono && "font-mono text-xs", className))} />
  );
}

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** Checkbox with its own label and hint, sized for a comfortable hit target. */
export function Checkbox({ label, hint, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx("flex min-w-0 cursor-pointer items-start gap-2.5", className)}>
      <input
        {...rest}
        type="checkbox"
        className={cx("mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm", FOCUS_RING)}
      />
      <span className="min-w-0 text-xs">
        <span className="block font-medium text-ink">{label}</span>
        {hint != null ? <span className="mt-0.5 block text-ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
