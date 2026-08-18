import type { SubmissionVerdict } from "@lcs/core";

/**
 * Judge verdicts, normalized.
 *
 * Both sites render the same handful of phrases, so the mapping is shared rather than
 * duplicated. Matching on the displayed string is deliberate: it's the one thing a site
 * can't quietly change without its own UI changing too.
 */
const BY_DISPLAY: Record<string, SubmissionVerdict> = {
  accepted: "accepted",
  "wrong answer": "wrong_answer",
  "time limit exceeded": "time_limit_exceeded",
  "memory limit exceeded": "memory_limit_exceeded",
  "output limit exceeded": "other",
  "runtime error": "runtime_error",
  "compile error": "compile_error",
  "compilation error": "compile_error",
};

/** LeetCode's numeric codes, used only when the display string is unrecognized. */
const BY_CODE: Record<number, SubmissionVerdict> = {
  10: "accepted",
  11: "wrong_answer",
  12: "memory_limit_exceeded",
  13: "other",
  14: "time_limit_exceeded",
  15: "runtime_error",
  20: "compile_error",
};

export function toVerdict(display: unknown, code?: unknown): SubmissionVerdict {
  if (typeof display === "string" && display.length > 0) {
    const known = BY_DISPLAY[display.trim().toLowerCase()];
    if (known) return known;
  }
  if (typeof code === "number") return BY_CODE[code] ?? "other";
  return "other";
}
