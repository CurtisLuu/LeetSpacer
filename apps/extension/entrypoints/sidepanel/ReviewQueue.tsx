import type { ReviewRating, TrackId } from "@lcs/core";
import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  DifficultyBadge,
  DueBadge,
  Empty,
  GradeButtons,
  Meter,
  Section,
  TRACK_LABELS,
  Tooltip,
  TopicChip,
} from "../../components/ui";
import { relativeDays } from "../../lib/format";
import { type ReviewItem, send } from "../../lib/messaging";
import { openWelcome } from "../../lib/welcome";

export function ReviewQueue({ track }: { track: TrackId }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [scheduledAhead, setScheduledAhead] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);
  const [pendingRating, setPendingRating] = useState<ReviewRating | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(0);
  const [doneThisSession, setDoneThisSession] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const result = await send("reviews:due", { track });
      setItems(result.items);
      setTotalDue(result.totalDue);
      setScheduledAhead(result.scheduledAhead);
      setLimit(result.limit);
      setNextDueAt(result.nextDueAt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [track]);

  useEffect(() => {
    void refresh();

    // Data can arrive from elsewhere — a sync on neetcode.io, or an import on the
    // options page — and the panel stays open across all of it.
    const timer = setInterval(() => void refresh(), 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const grade = useCallback(
    async (slug: string, rating: ReviewRating) => {
      setGrading(slug);
      setPendingRating(rating);
      try {
        const { nextDue } = await send("reviews:grade", { track, slug, rating });
        // Drop it locally first so the row leaves immediately, then resync.
        setItems((current) => current.filter((item) => item.slug !== slug));
        setTotalDue((current) => Math.max(0, current - 1));
        setDoneThisSession((current) => current + 1);
        setExpanded(null);
        setError(null);
        await refresh();
        return nextDue;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setGrading(null);
        setPendingRating(null);
      }
    },
    [refresh, track],
  );

  // Says where the rest of the track went. Without it a queue of 3 out of 47 tracked
  // problems reads as data loss rather than as pacing.
  const ahead =
    scheduledAhead > 0
      ? `${scheduledAhead} more scheduled${
          nextDueAt === null ? "" : `, next ${formatDueDate(nextDueAt)}`
        }.`
      : undefined;

  if (error) {
    return (
      <Section title="Today">
        <Callout tone="danger" title="Couldn't load the queue">
          {error}
        </Callout>
      </Section>
    );
  }

  if (items.length === 0) {
    // "Nothing due" and "nothing here" are different states, and only the second one
    // should send you off to sync something.
    const nothingTracked = totalDue === 0 && scheduledAhead === 0;

    return (
      <Section title="Today" description={ahead}>
        <Empty
          title={
            doneThisSession > 0 ? "Done for today" : nothingTracked ? "Nothing here yet" : "Nothing due"
          }
          body={
            doneThisSession > 0
              ? `${doneThisSession} reviewed. The next batch comes due on its own.`
              : nothingTracked
                ? track === "leetcode"
                  ? "Open leetcode.com while signed in and your submission history syncs automatically."
                  : "Open neetcode.io/practice while signed in and your completed problems sync automatically."
                : totalDue === 0
                  ? "Everything in this track is scheduled ahead. Nothing to do today."
                  : `You've hit today's review limit for the ${TRACK_LABELS[track]} track. Raise it in settings if you want more.`
          }
          action={
            nothingTracked ? (
              <Button variant="secondary" size="sm" onClick={openWelcome}>
                Getting started
              </Button>
            ) : undefined
          }
        />
      </Section>
    );
  }

  return (
    <Section
      title="Today"
      description={ahead}
      badge={
        <Tooltip
          label={`${totalDue} due in total, capped to ${limit} a day in settings`}
          align="start"
        >
          <Badge tone="accent">
            {items.length} of {totalDue}
          </Badge>
        </Tooltip>
      }
    >
      {doneThisSession > 0 ? (
        <Meter
          value={doneThisSession}
          max={doneThisSession + items.length}
          label="Reviewed"
          tone="good"
          size="sm"
        />
      ) : null}

      <ul className="space-y-2">
        {items.map((item) => {
          const isOpen = expanded === item.slug;
          const isBusy = grading === item.slug;

          return (
            <Card as="li" key={item.slug} interactive className="group/row">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <Tooltip
                  label={
                    item.site === "neetcode"
                      ? "Open on NeetCode"
                      : "Open on LeetCode — NeetCode has no page for this one"
                  }
                  align="start"
                >
                  <a
                    className="min-w-0 font-medium text-accent underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.title}
                  </a>
                </Tooltip>

                <Tooltip
                  label={
                    item.overdueDays >= 0
                      ? `Was due ${relativeDays(item.overdueDays)} ago`
                      : `Not due for another ${relativeDays(item.overdueDays)}`
                  }
                  align="end"
                >
                  <DueBadge overdueDays={item.overdueDays} />
                </Tooltip>
              </div>

              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                <DifficultyBadge difficulty={item.difficulty} />
                {item.topicTags.map((tag) => (
                  <TopicChip key={tag} topic={tag} />
                ))}
              </div>

              <p className="mt-1.5 text-xs text-ink-subtle">
                {item.attempts > 1 ? (
                  <Tooltip label="Submissions it took you to pass. More means it was seeded as harder." align="start">
                    <span className="cursor-help underline decoration-dotted underline-offset-2">
                      {item.attempts} submissions
                    </span>
                  </Tooltip>
                ) : null}
                {item.attempts > 1 ? " · " : ""}
                {item.lastSolvedAt
                  ? `solved ${new Date(item.lastSolvedAt).toLocaleDateString()}`
                  : "never solved"}
                {item.reps > 0 ? ` · ${item.reps} review${item.reps === 1 ? "" : "s"}` : ""}
              </p>

              {isOpen ? (
                <div className="mt-2">
                  <p className="mb-1 text-xs text-ink-muted">How well did you recall it?</p>
                  <GradeButtons
                    onGrade={(rating) => void grade(item.slug, rating)}
                    disabled={isBusy}
                    pendingRating={isBusy ? pendingRating : null}
                  />
                </div>
              ) : (
                <Button
                  className="mt-2 opacity-90 transition-opacity group-hover/row:opacity-100"
                  variant="primary"
                  size="sm"
                  block
                  onClick={() => setExpanded(item.slug)}
                >
                  Rate this
                </Button>
              )}
            </Card>
          );
        })}
      </ul>
    </Section>
  );
}

/** "tomorrow" / "Thu" / "18 Aug" — whichever is shortest and still unambiguous. */
function formatDueDate(at: number): string {
  const days = Math.ceil((at - Date.now()) / 86_400_000);
  if (days <= 1) return "tomorrow";
  if (days < 7) return new Date(at).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
