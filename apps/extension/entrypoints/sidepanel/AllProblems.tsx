import type { TrackId } from "@lcs/core";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Callout, DifficultyBadge, Section, Tooltip } from "../../components/ui";
import { formatCountdown, isImminent } from "../../lib/format";
import { type ReviewItem, send } from "../../lib/messaging";

/**
 * Everything in the track, soonest-due first, with a countdown to each unlock.
 *
 * The queue deliberately shows only what's due today, which leaves no way to see the rest
 * of the schedule — how much is waiting, and how long until it comes back. This is that
 * view, kept behind a toggle because most of the time the answer is "not yet" and the
 * queue is the thing worth looking at.
 */
export function AllProblems({ track }: { track: TrackId }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const result = await send("reviews:all", { track });
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [track]);

  // Fetched on open rather than polled: the list is long, and nothing in it changes
  // second to second except the countdowns, which tick locally.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    // Ten seconds is enough for a minute-granularity countdown to never look stuck,
    // without re-rendering a few hundred rows every tick.
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [open]);

  const total = items?.length ?? 0;
  const locked = items?.filter((item) => item.due > now).length ?? 0;

  return (
    <Section
      title="All problems"
      badge={
        items === null ? null : (
          <Tooltip label={`${total - locked} available now, ${locked} still locked`} align="start">
            <Badge tone="neutral">{total}</Badge>
          </Tooltip>
        )
      }
      action={
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {!open ? null : error ? (
        <Callout tone="danger" title="Couldn't load the list">
          {error}
        </Callout>
      ) : items === null ? (
        <p className="text-xs text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-ink-muted">Nothing tracked in this track yet.</p>
      ) : (
        // Capped height with its own scroll: this can be hundreds of rows, and it sits
        // above the rest of the panel rather than burying it.
        <ul className="max-h-96 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-1.5">
          {items.map((item) => (
            <Row key={item.slug} item={item} now={now} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Row({ item, now }: { item: ReviewItem; now: number }) {
  const remaining = item.due - now;
  const unlocked = remaining <= 0;

  return (
    <li className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-raised">
      <div className="flex min-w-0 items-center gap-1.5">
        <DifficultyBadge difficulty={item.difficulty} />
        <a
          className="min-w-0 truncate text-xs text-ink hover:text-accent hover:underline"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={item.title}
        >
          {item.title}
        </a>
      </div>

      <Tooltip
        label={
          unlocked
            ? "Available now"
            : `Unlocks ${new Date(item.due).toLocaleString()} · ${item.reps} review${item.reps === 1 ? "" : "s"} so far`
        }
        align="end"
      >
        <Badge
          tone={unlocked ? "good" : isImminent(remaining) ? "warn" : "neutral"}
          className="tabular-nums"
        >
          {formatCountdown(remaining)}
        </Badge>
      </Tooltip>
    </li>
  );
}
