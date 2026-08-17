/**
 * Folding the ingest event log into per-problem state.
 *
 * Contract: each event is applied **at most once**. Deduplication happens at the
 * storage boundary (`EventStore.append` keys on the deterministic `event.id`), which
 * lets this reducer keep running counters without tracking what it has already seen.
 *
 * Within that contract the fold is order-independent: timestamps combine with
 * min/max, status only ever ratchets upward, and sources union.
 */

import {
  type ProblemState,
  type ProgressEvent,
  type ProblemStatus,
  type ProviderId,
  type Timestamp,
  emptyProblemState,
  eventOccurredAt,
} from "./model.js";

const STATUS_RANK: Record<ProblemStatus, number> = {
  todo: 0,
  attempted: 1,
  solved: 2,
};

/** Status never regresses — an old "attempted" event can't un-solve a problem. */
function raiseStatus(current: ProblemStatus, next: ProblemStatus): ProblemStatus {
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

function earliest(a: Timestamp | null, b: Timestamp): Timestamp {
  return a === null ? b : Math.min(a, b);
}

function latest(a: Timestamp | null, b: Timestamp): Timestamp {
  return a === null ? b : Math.max(a, b);
}

function withSource(sources: ProviderId[], provider: ProviderId): ProviderId[] {
  return sources.includes(provider) ? sources : [...sources, provider];
}

/**
 * Apply one event to one problem's state, returning a new state object.
 * Pass `undefined` for a problem seen for the first time.
 */
export function applyEvent(state: ProblemState | undefined, ev: ProgressEvent): ProblemState {
  const base = state ?? emptyProblemState(ev.slug, ev.observedAt);
  const next: ProblemState = {
    ...base,
    listChecked: { ...base.listChecked },
    sources: withSource(base.sources, ev.provider),
    updatedAt: Math.max(base.updatedAt, ev.observedAt),
  };

  switch (ev.type) {
    case "problem_solved": {
      next.status = raiseStatus(next.status, "solved");
      next.firstSolvedAt = earliest(next.firstSolvedAt, ev.solvedAt);
      next.lastSolvedAt = latest(next.lastSolvedAt, ev.solvedAt);
      break;
    }

    case "problem_attempted": {
      next.status = raiseStatus(next.status, "attempted");
      break;
    }

    case "submission_result": {
      next.attempts += 1;
      if (ev.verdict === "accepted") {
        next.acceptedCount += 1;
        next.status = raiseStatus(next.status, "solved");
        next.firstSolvedAt = earliest(next.firstSolvedAt, ev.submittedAt);
        next.lastSolvedAt = latest(next.lastSolvedAt, ev.submittedAt);
      } else {
        next.status = raiseStatus(next.status, "attempted");
      }
      break;
    }

    case "list_checked": {
      next.listChecked[ev.list] = ev.checked;
      // A NeetCode checkmark is a claim about progress, but a weak one — it never
      // upgrades status on its own. LeetCode submission data is the source of truth.
      break;
    }
  }

  return next;
}

/**
 * Fold a batch of events over existing state.
 * `initial` is not mutated; the returned map contains only touched problems.
 */
export function foldEvents(
  initial: ReadonlyMap<string, ProblemState>,
  events: readonly ProgressEvent[],
): Map<string, ProblemState> {
  const touched = new Map<string, ProblemState>();

  for (const ev of sortByOccurrence(events)) {
    const current = touched.get(ev.slug) ?? initial.get(ev.slug);
    touched.set(ev.slug, applyEvent(current, ev));
  }

  return touched;
}

/**
 * Chronological by the time the event *describes*. The fold is order-independent by
 * construction, but sorting keeps derived counters and debugging output stable.
 */
export function sortByOccurrence(events: readonly ProgressEvent[]): ProgressEvent[] {
  return [...events].sort((a, b) => eventOccurredAt(a) - eventOccurredAt(b));
}
