import type { TrackId } from "@lcs/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  DifficultyBadge,
  Logo,
  TRACK_LABELS,
  Tooltip,
  TopicChip,
  TrackSwitcher,
  cx,
} from "../../components/ui";
import { formatCountdown, isImminent } from "../../lib/format";
import { type ReviewItem, send } from "../../lib/messaging";
import { useTrack } from "../../lib/use-track";

/**
 * Every problem in a track, with a countdown to when it comes back.
 *
 * A tab rather than a panel section: this is a table of a few hundred rows, and the side
 * panel is a few hundred pixels wide. The queue answers "what now"; this answers "what
 * have I got, and when does it return".
 */
type Filter = "all" | "available" | "locked";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "locked", label: "Locked" },
];

export function App() {
  const { track, setTrack } = useTrack();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (which: TrackId) => {
    try {
      setItems(null);
      const result = await send("reviews:all", { track: which });
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (track) void load(track);
  }, [track, load]);

  useEffect(() => {
    // Ten seconds keeps a minute-granularity countdown from ever looking stuck, without
    // re-rendering the table on every frame.
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    if (!items) return [];
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "available" && item.due > now) return false;
      if (filter === "locked" && item.due <= now) return false;
      if (needle && !item.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, filter, query, now]);

  const available = items?.filter((item) => item.due <= now).length ?? 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 text-sm">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <h1 className="text-lg font-semibold">Problems</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings
        </Button>
      </header>

      <TrackSwitcher
        className="mb-4"
        value={track ?? "neetcode"}
        disabled={track === null}
        onChange={setTrack}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cx(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === option.id
                  ? "bg-accent-soft text-accent"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs"
        />

        {items !== null ? (
          <span className="text-xs tabular-nums text-ink-subtle">
            {available} available · {items.length - available} locked
          </span>
        ) : null}
      </div>

      {error ? (
        <Callout tone="danger" title="Couldn't load the list">
          {error}
        </Callout>
      ) : items === null ? (
        <p className="text-xs text-ink-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-ink-muted">
          {items.length === 0
            ? `Nothing tracked in the ${TRACK_LABELS[track ?? "neetcode"]} track yet.`
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {visible.map((item) => (
            <Row key={item.slug} item={item} now={now} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Row({ item, now }: { item: ReviewItem; now: number }) {
  const remaining = item.due - now;
  const unlocked = remaining <= 0;

  return (
    <li className="flex min-w-0 items-center gap-3 bg-surface-raised px-3 py-2 hover:bg-surface-sunken">
      <DifficultyBadge difficulty={item.difficulty} />

      <div className="min-w-0 flex-1">
        <a
          className="truncate font-medium text-ink hover:text-accent hover:underline"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          {item.title}
        </a>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
          {item.topicTags.map((tag) => (
            <TopicChip key={tag} topic={tag} />
          ))}
          <span className="text-xs text-ink-subtle">
            {item.reps > 0 ? `${item.reps} review${item.reps === 1 ? "" : "s"}` : "not reviewed"}
            {item.lastSolvedAt
              ? ` · solved ${new Date(item.lastSolvedAt).toLocaleDateString()}`
              : ""}
          </span>
        </div>
      </div>

      <Tooltip
        label={unlocked ? "Available now" : `Unlocks ${new Date(item.due).toLocaleString()}`}
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
