import { Rating, type ReviewRating } from "@lcs/core";

import { FOCUS_RING, cx } from "./cx";

export interface GradeOption {
  rating: ReviewRating;
  label: string;
  /** One-line explanation, surfaced as the tooltip. */
  hint: string;
}

/** The four FSRS answers, in scale order. Shared so every surface words them alike. */
export const GRADES: readonly GradeOption[] = [
  { rating: Rating.Again, label: "Again", hint: "Couldn't do it" },
  { rating: Rating.Hard, label: "Hard", hint: "Struggled through" },
  { rating: Rating.Good, label: "Good", hint: "Got it" },
  { rating: Rating.Easy, label: "Easy", hint: "Instant" },
];

const GRADE_TONES: Record<ReviewRating, { rest: string; selected: string }> = {
  [Rating.Again]: {
    rest: cx(
      "border-grade-again/35 bg-grade-again-soft text-grade-again",
      "hover:not-disabled:border-grade-again/70",
    ),
    selected: "border-transparent bg-grade-again-solid text-on-solid",
  },
  [Rating.Hard]: {
    rest: cx(
      "border-grade-hard/35 bg-grade-hard-soft text-grade-hard",
      "hover:not-disabled:border-grade-hard/70",
    ),
    selected: "border-transparent bg-grade-hard-solid text-on-solid",
  },
  [Rating.Good]: {
    rest: cx(
      "border-grade-good/35 bg-grade-good-soft text-grade-good",
      "hover:not-disabled:border-grade-good/70",
    ),
    selected: "border-transparent bg-grade-good-solid text-on-solid",
  },
  [Rating.Easy]: {
    rest: cx(
      "border-grade-easy/35 bg-grade-easy-soft text-grade-easy",
      "hover:not-disabled:border-grade-easy/70",
    ),
    selected: "border-transparent bg-grade-easy-solid text-on-solid",
  },
};

export interface GradeButtonProps {
  rating: ReviewRating;
  /** Defaults to the shared label for the rating. */
  label?: string;
  /** Defaults to the shared hint; becomes the tooltip and the accessible name suffix. */
  hint?: string;
  onSelect: (rating: ReviewRating) => void;
  disabled?: boolean;
  /** This grade is the one being submitted right now. */
  pending?: boolean;
  /** Sticky highlight, e.g. the grade the scheduler suggests. */
  selected?: boolean;
  className?: string;
}

/**
 * One grade. Colour carries the meaning — red through blue is the recall
 * scale — but the word is always present, so the control never depends on colour
 * alone.
 */
export function GradeButton({
  rating,
  label,
  hint,
  onSelect,
  disabled = false,
  pending = false,
  selected = false,
  className,
}: GradeButtonProps) {
  const option = GRADES.find((grade) => grade.rating === rating);
  const text = label ?? option?.label ?? String(rating);
  const tooltip = hint ?? option?.hint ?? "";
  const tone = GRADE_TONES[rating];

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-busy={pending || undefined}
      aria-label={tooltip ? `${text} — ${tooltip}` : text}
      title={tooltip}
      onClick={() => onSelect(rating)}
      className={cx(
        // h-9 keeps the target comfortable; min-w-0 lets four of them share a
        // 250px panel without any of them forcing a horizontal scrollbar.
        "flex h-9 min-w-0 items-center justify-center rounded-md border px-1 text-xs font-semibold",
        "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50",
        selected || pending ? tone.selected : tone.rest,
        FOCUS_RING,
        className,
      )}
    >
      <span className="truncate">{text}</span>
    </button>
  );
}

export interface GradeButtonsProps {
  onGrade: (rating: ReviewRating) => void;
  disabled?: boolean;
  /** The grade currently being submitted, if any. */
  pendingRating?: ReviewRating | null;
  /** Highlighted without being pending — a suggestion. */
  selectedRating?: ReviewRating | null;
  className?: string;
}

/**
 * The full answer row. Two columns when the panel is dragged narrow, four when
 * there is room — a container query, so it reacts to the card it sits in rather
 * than to the window.
 */
export function GradeButtons({
  onGrade,
  disabled = false,
  pendingRating = null,
  selectedRating = null,
  className,
}: GradeButtonsProps) {
  return (
    <div className={cx("@container", className)}>
      <div className="grid grid-cols-2 gap-1.5 @min-[15rem]:grid-cols-4">
        {GRADES.map((grade) => (
          <GradeButton
            key={grade.rating}
            rating={grade.rating}
            label={grade.label}
            hint={grade.hint}
            disabled={disabled}
            pending={pendingRating === grade.rating}
            selected={selectedRating === grade.rating}
            onSelect={onGrade}
          />
        ))}
      </div>
    </div>
  );
}
