import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThrottle } from "./throttle.js";

describe("createThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets the first call through immediately", async () => {
    const throttle = createThrottle(500);
    let done = false;

    void throttle().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(done).toBe(true);
  });

  it("spaces subsequent calls by the minimum interval", async () => {
    const throttle = createThrottle(500);
    await throttle();

    let done = false;
    void throttle().then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("keeps spacing across a burst rather than letting them bunch up", async () => {
    const throttle = createThrottle(200);
    const completions: number[] = [];

    for (let i = 0; i < 4; i++) {
      void throttle().then(() => completions.push(Date.now()));
    }

    await vi.advanceTimersByTimeAsync(1_000);

    expect(completions).toHaveLength(4);
    for (let i = 1; i < completions.length; i++) {
      expect(completions[i]! - completions[i - 1]!).toBeGreaterThanOrEqual(200);
    }
  });
});
