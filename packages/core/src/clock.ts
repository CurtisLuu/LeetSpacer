import type { Timestamp } from "./model.js";

/**
 * Injected everywhere time is read. Scheduling logic is impossible to test against
 * a real clock, and the dev build needs to fast-forward to verify review queues.
 */
export interface Clock {
  now(): Timestamp;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** Test/dev clock. `advance` moves it forward without touching global state. */
export function fixedClock(start: Timestamp): Clock & { advance(ms: number): void; set(at: Timestamp): void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (at) => {
      current = at;
    },
  };
}

export const MS_PER_DAY = 86_400_000;

export function daysBetween(from: Timestamp, to: Timestamp): number {
  return (to - from) / MS_PER_DAY;
}
