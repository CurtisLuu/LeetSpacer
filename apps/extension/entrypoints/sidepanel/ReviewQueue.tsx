import { Rating, type ReviewRating } from "@lcs/core";
import { useCallback, useEffect, useState } from "react";

import { Empty, Section } from "../../components/ui";
import { relativeDays } from "../../lib/format";
import { type ReviewItem, send } from "../../lib/messaging";

/** Difficulty is the one label worth colouring — it sets expectations before you click. */
const DIFFICULTY_CLASS: Record<string, string> = {
  Easy: "bg-[--color-difficulty-easy-soft] text-[--color-difficulty-easy]",
  Medium: "bg-[--color-difficulty-medium-soft] text-[--color-difficulty-medium]",
  Hard: "bg-[--color-difficulty-hard-soft] text-[--color-difficulty-hard]",
};

const GRADES: { rating: ReviewRating; label: string; hint: string }[] = [
  { rating: Rating.Again, label: "Again", hint: "Couldn't do it" },
  { rating: Rating.Hard, label: "Hard", hint: "Struggled through" },
  { rating: Rating.Good, label: "Good", hint: "Got it" },
  { rating: Rating.Easy, label: "Easy", hint: "Instant" },
];

export function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await send("reviews:due", {});
      setItems(result.items);
      setTotalDue(result.totalDue);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();

    // Data can arrive from elsewhere — a GitHub sync or a JSON import on the options
    // page — and the panel stays open across all of it. Without this the queue only
    // updated when the panel was reopened.
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
      try {
        await send("reviews:grade", { slug, rating });
        // Drop it locally first so the row disappears immediately, then resync.
        setItems((current) => current.filter((item) => item.slug !== slug));
        setTotalDue((current) => Math.max(0, current - 1));
        setExpanded(null);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setGrading(null);
      }
    },
    [refresh],
  );

  if (error) {
    return (
      <Section title="Today">
        <p className="rounded-lg border border-[--color-border] p-3 text-xs text-[--color-warn]">
          {error}
        </p>
      </Section>
    );
  }

  if (items.length === 0) {
    return (
      <Section title="Today">
        <Empty
          title={totalDue === 0 ? "Nothing due" : "All caught up for today"}
          body={
            totalDue === 0
              ? "Import your NeetCode history to build a review schedule: pnpm import:neetcode, then Import JSON in settings."
              : "You've hit today's review limit. Raise it in settings if you want more."
          }
        />
      </Section>
    );
  }

  return (
    <Section title={`Today — ${items.length} of ${totalDue} due`}>
      <ul className="space-y-2">
        {items.map((item) => {
          const isOpen = expanded === item.slug;
          const isBusy = grading === item.slug;

          return (
            <li
              key={item.slug}
              className="rounded-lg border border-[--color-border] bg-[--color-surface-raised] p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <a
                  className="min-w-0 font-medium text-[--color-accent] underline underline-offset-2"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title}
                </a>
                <span className="shrink-0 text-[11px] text-[--color-ink-muted]">
                  {item.overdueDays >= 0
                    ? `${relativeDays(item.overdueDays)} overdue`
                    : `due in ${relativeDays(item.overdueDays)}`}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                {item.difficulty ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${DIFFICULTY_CLASS[item.difficulty]}`}
                  >
                    {item.difficulty}
                  </span>
                ) : null}
                {item.topicTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-[--color-surface] px-1.5 py-0.5 text-[--color-ink-muted]"
                  >
                    {tag.replace(/-/g, " ")}
                  </span>
                ))}
              </div>

              <p className="mt-1 text-[11px] text-[--color-ink-muted]">
                {item.attempts > 1 ? `${item.attempts} submissions · ` : ""}
                {item.lastSolvedAt
                  ? `solved ${new Date(item.lastSolvedAt).toLocaleDateString()}`
                  : "never solved"}
                {item.reps > 0 ? ` · ${item.reps} review${item.reps === 1 ? "" : "s"}` : ""}
              </p>

              {isOpen ? (
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {GRADES.map((option) => (
                    <button
                      key={option.rating}
                      type="button"
                      disabled={isBusy}
                      title={option.hint}
                      className="rounded-md border border-[--color-border] px-1 py-1.5 text-[11px] font-medium disabled:opacity-50"
                      onClick={() => void grade(item.slug, option.rating)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-2 w-full rounded-md bg-[--color-accent] px-2 py-1.5 text-[11px] font-semibold text-[--color-accent-ink]"
                  onClick={() => setExpanded(item.slug)}
                >
                  Rate this
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
