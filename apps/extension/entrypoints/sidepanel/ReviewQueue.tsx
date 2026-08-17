import type { ReviewRating, TrackId } from "@lcs/core";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { formatCountdown, relativeDays } from "../../lib/format";
import { type ReviewItem, send } from "../../lib/messaging";
import { openWelcome } from "../../lib/pages";

export function ReviewQueue({ track }: { track: TrackId }) {
  /** Everything the background last returned, batch member or not. */
  const [fetched, setFetched] = useState<ReviewItem[]>([]);
  /**
   * The slugs that make up this session's batch.
   *
   * Held separately from the fetch so the queue stops refilling itself. Previously the
   * poll overwrote the list with the server's top N, so grading one pulled the next one
   * in and the queue never got shorter — you could work for ten minutes and end up
   * looking at the same number of rows you started with.
   */
  const [batch, setBatch] = useState<string[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [scheduledAhead, setScheduledAhead] = useState(0);
  const [nextDueAt, setNextDueAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);
  const [pendingRating, setPendingRating] = useState<ReviewRating | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The daily cap the background applied, which is also one batch's worth. */
  const [dailyLimit, setDailyLimit] = useState(0);
  /**
   * How many to ask for. Grows only when you press the button.
   *
   * A ref, not state: the polling effect reads it, and if it were a dependency then every
   * change would tear the effect down and re-run its adopting first load — quietly
   * refilling the batch, which is the exact behaviour being removed.
   */
  const requested = useRef<number | null>(null);
  const [doneThisSession, setDoneThisSession] = useState(0);
  const [reviewedToday, setReviewedToday] = useState(0);
  /** The card just graded and when it returns, so a short interval isn't a surprise. */
  const [lastGraded, setLastGraded] = useState<{ title: string; due: number } | null>(null);

  /** Title of a slug from whatever the last fetch returned, falling back to the slug. */
  const titleOf = useCallback(
    (slug: string) => fetched.find((item) => item.slug === slug)?.title ?? slug,
    [fetched],
  );

  const load = useCallback(
    async (adopt: boolean, limit?: number) => {
      try {
        const result = await send("reviews:due", {
          track,
          ...(limit === undefined ? {} : { limit }),
        });
        setFetched(result.items);
        setTotalDue(result.totalDue);
        setScheduledAhead(result.scheduledAhead);
        setDailyLimit(result.limit);
        setNextDueAt(result.nextDueAt);
        setReviewedToday(result.reviewedToday);
        setError(null);

        // Only an explicit load takes new slugs into the batch. A poll refreshes what's
        // already there and nothing more.
        if (adopt) {
          setBatch((current) => {
            const seen = new Set(current);
            return [...current, ...result.items.map((i) => i.slug).filter((s) => !seen.has(s))];
          });
        }
        return result;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [track],
  );

  useEffect(() => {
    let cancelled = false;
    void load(true).then((result) => {
      if (!cancelled && result) requested.current = result.limit;
    });

    // Data can arrive from elsewhere — a sync on neetcode.io, or an import on the
    // options page — so the panel keeps the rows it is showing up to date. It does not
    // reach for new ones.
    const poll = () => void load(false, requested.current ?? undefined);
    const timer = setInterval(poll, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const loadMore = useCallback(async () => {
    const step = Math.max(1, dailyLimit);
    requested.current = (requested.current ?? dailyLimit) + step;
    await load(true, requested.current);
  }, [load, dailyLimit]);

  const grade = useCallback(
    async (slug: string, rating: ReviewRating) => {
      setGrading(slug);
      setPendingRating(rating);
      try {
        const { nextDue } = await send("reviews:grade", { track, slug, rating });
        setLastGraded({ title: titleOf(slug), due: nextDue });
        // Out of the batch for good. Rating something Again reschedules it minutes away,
        // and having it reappear underneath you is the behaviour this batch exists to stop.
        setBatch((current) => current.filter((s) => s !== slug));
        setTotalDue((current) => Math.max(0, current - 1));
        setDoneThisSession((current) => current + 1);
        setExpanded(null);
        setError(null);
        await load(false, requested.current ?? undefined);
        return nextDue;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setGrading(null);
        setPendingRating(null);
      }
    },
    [load, titleOf, track],
  );

  // The batch, in the order it was taken, dropping anything no longer due.
  const bySlug = new Map(fetched.map((item) => [item.slug, item]));
  const items = batch
    .map((slug) => bySlug.get(slug))
    .filter((item): item is ReviewItem => item !== undefined);

  const remaining = Math.max(0, totalDue - items.length);
  const note = [
    remaining > 0 ? `${remaining} more due beyond this batch.` : null,
    scheduledAhead > 0
      ? `${scheduledAhead} scheduled${nextDueAt === null ? "" : `, next ${formatDueDate(nextDueAt)}`}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  /**
   * The day's work, not the panel session's.
   *
   * Counted from the review log, so closing the side panel doesn't reset it — the old
   * in-memory counter went back to zero every time, which made the bar useless for
   * exactly the question it was there to answer.
   */
  const dayBar = (
    <Meter
      value={reviewedToday}
      max={Math.max(dailyLimit || 1, reviewedToday)}
      label="Reviewed today"
      tone="accent"
      size="sm"
    />
  );

  const returning =
    lastGraded !== null && lastGraded.due > Date.now() ? (
      <Callout tone="neutral" className="mb-2">
        <span className="truncate">{lastGraded.title}</span> comes back in{" "}
        <strong className="font-medium">{formatCountdown(lastGraded.due - Date.now())}</strong>.
      </Callout>
    ) : null;

  const more =
    remaining > 0 ? (
      <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
        Load {Math.min(remaining, Math.max(1, dailyLimit))} more
      </Button>
    ) : undefined;

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
      <Section title="Today" description={note || undefined}>
        {reviewedToday > 0 ? dayBar : null}
        {returning}
        <Empty
          title={
            doneThisSession > 0 ? "Batch done" : nothingTracked ? "Nothing here yet" : "Nothing due"
          }
          body={
            doneThisSession > 0
              ? remaining > 0
                ? "Take another batch whenever you want one."
                : "The next batch comes due on its own."
              : nothingTracked
                ? track === "leetcode"
                  ? "Open leetcode.com while signed in and your submission history syncs automatically."
                  : "Open neetcode.io/practice while signed in and your completed problems sync automatically."
                : totalDue === 0
                  ? "Everything in this track is scheduled ahead. Nothing to do today."
                  : `${totalDue} due in the ${TRACK_LABELS[track]} track.`
          }
          action={
            nothingTracked ? (
              <Button variant="secondary" size="sm" onClick={openWelcome}>
                Getting started
              </Button>
            ) : (
              more
            )
          }
        />
      </Section>
    );
  }

  return (
    <Section
      title="Today"
      description={note || undefined}
      badge={
        <Tooltip
          label={`${totalDue} due in total. A batch is ${dailyLimit}, set by the daily limit in settings.`}
          align="start"
        >
          <Badge tone="accent">{items.length} left</Badge>
        </Tooltip>
      }
    >
      {dayBar}
      {returning}

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
