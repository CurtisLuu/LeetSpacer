import { describe, expect, it } from "vitest";

import { formatCountdown, formatDueDate, relativeDays, titleFromSlug } from "./format.js";

/** A Wednesday at 09:00 local, so "later today" and "tomorrow" are unambiguous. */
const NOW = new Date(2026, 7, 19, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("formatDueDate", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    // The bug: anything under a day rounded up to "tomorrow", so a card coming back at
    // nine tonight was announced as tomorrow's — while "reviewed today" was already
    // counting from local midnight, so the two disagreed by a day.
    expect(formatDueDate(NOW + 2 * HOUR, NOW)).toBe("later today");
    expect(formatDueDate(NOW + 12 * HOUR, NOW)).toBe("later today");
    // 09:00 plus 20 hours is 05:00 the next morning: a different day, and under a day away.
    expect(formatDueDate(NOW + 20 * HOUR, NOW)).toBe("tomorrow");
  });

  it("says now for anything already due", () => {
    expect(formatDueDate(NOW, NOW)).toBe("now");
    expect(formatDueDate(NOW - DAY, NOW)).toBe("now");
  });

  it("names the weekday inside a week, then the date", () => {
    expect(formatDueDate(NOW + 3 * DAY, NOW)).toMatch(/day$/);
    // Eight days out, where a weekday name would be ambiguous with this week's.
    expect(formatDueDate(NOW + 8 * DAY, NOW)).toMatch(/\d/);
  });
});

describe("formatCountdown", () => {
  it("picks the coarsest unit that still says something", () => {
    expect(formatCountdown(-1)).toBe("due now");
    expect(formatCountdown(30_000)).toBe("30s");
    expect(formatCountdown(6 * 60_000)).toBe("6m");
    expect(formatCountdown(2 * HOUR + 5 * 60_000)).toBe("2h");
    expect(formatCountdown(3 * DAY)).toBe("3d");
    expect(formatCountdown(400 * DAY)).toBe("1y");
  });
});

describe("relativeDays and titleFromSlug", () => {
  it("reads as a person would say it", () => {
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(1)).toBe("1 day");
    expect(relativeDays(-3)).toBe("3 days");
    expect(titleFromSlug("longest-substring-without-repeating-characters")).toBe(
      "Longest Substring Without Repeating Characters",
    );
    expect(titleFromSlug("lru-cache")).toBe("LRU Cache");
  });
});
