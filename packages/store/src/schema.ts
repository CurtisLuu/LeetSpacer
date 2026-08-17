import type { ProblemState, ProgressEvent, ReviewCard, ReviewLog } from "@lcs/core";
import type { DBSchema } from "idb";

export const DB_NAME = "leetcode-spaced";
export const DB_VERSION = 1;

/** Settings and sync cursors share one key-value store to keep the schema small. */
export const SETTINGS_KEY = "settings";
export const META_PREFIX = "meta:";

export interface LcsDB extends DBSchema {
  events: {
    key: string;
    value: ProgressEvent;
    indexes: { observedAt: number };
  };
  problems: {
    key: string;
    value: ProblemState;
    indexes: { status: string; lastSolvedAt: number };
  };
  cards: {
    key: string;
    value: ReviewCard;
    indexes: { due: number };
  };
  logs: {
    key: string;
    value: ReviewLog;
    indexes: { slug: string; reviewedAt: number };
  };
  kv: {
    key: string;
    value: unknown;
  };
}
