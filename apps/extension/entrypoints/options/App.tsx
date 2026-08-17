import {
  type ProviderId,
  type Settings,
  type TrackId,
  type TrackSettings,
  parseSnapshot,
} from "@lcs/core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Button,
  Callout,
  InfoDot,
  Logo,
  Section,
  TRACK_LABELS,
  Tooltip,
  TrackSwitcher,
} from "../../components/ui";
import { send } from "../../lib/messaging";
import { getStore } from "../../lib/store";
import { openWelcome } from "../../lib/welcome";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Which track's schedule is being edited. Local, not persisted: it's a view of this
  // page, not a preference, and it shouldn't move the side panel's selector.
  const [editing, setEditing] = useState<TrackId>("neetcode");
  const fileInput = useRef<HTMLInputElement>(null);

  const rebuildSchedule = useCallback(async (track: TrackId) => {
    try {
      const { rebuilt, kept } = await send("schedule:rebuild", { track });
      const where = `in the ${TRACK_LABELS[track]} track`;
      setFailed(false);
      setMessage(
        kept > 0
          ? `Rescheduled ${rebuilt} problems ${where}. ${kept} already graded, so those were left alone.`
          : `Rescheduled ${rebuilt} problems ${where}.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const resetData = useCallback(async () => {
    try {
      await send("data:reset", {});
      setConfirmingReset(false);
      setFailed(false);
      setMessage("Everything cleared. Open neetcode.io/practice to sync again.");
    } catch (error) {
      setFailed(true);
      setMessage(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  useEffect(() => {
    void getStore()
      .then((store) => store.settings.get())
      .then((loaded) => {
        setSettings(loaded);
        // Open on whatever the side panel is showing — that's the track you were just
        // looking at, and so almost always the one you came here to adjust.
        setEditing(loaded.activeTrack);
      });
  }, []);

  const patch = useCallback(async (update: Partial<Settings>) => {
    const store = await getStore();
    setSettings(await store.settings.update(update));
  }, []);

  const exportData = useCallback(async () => {
    const store = await getStore();
    const snapshot = await store.exportSnapshot();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `leetspacer-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const importJson = useCallback(async (text: string) => {
    try {
      const snapshot = parseSnapshot(text);
      const store = await getStore();
      // Merge, not replace: importing a backup should never silently drop newer local work.
      await store.importSnapshot(snapshot, "merge");
      setSettings(await store.settings.get());
      // The background owns the badge and has no idea we just wrote to the store.
      await send("data:changed", {}).catch(() => {});

      // Counted across both tracks: an import can land in either, and reporting only the
      // one this page happens to be showing would look like half the file went missing.
      const cards = (await store.cards.all()).length;
      const active = (await store.settings.get()).activeTrack;
      const due = (await store.cards.due(active, Date.now())).length;
      setFailed(false);
      setMessage(
        `Imported ${snapshot.problems.length} problems and ${snapshot.events.length} submissions. ` +
          `${cards} review cards, ${due} due now in the ${TRACK_LABELS[active]} track.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  if (!settings) return <main className="p-6 text-sm">Loading…</main>;

  const track = settings.tracks[editing];

  /** Turn one source's sync on or off, leaving the other alone. */
  const patchProvider = (provider: ProviderId, enabled: boolean) =>
    patch({
      providers: { ...settings.providers, [provider]: { ...settings.providers[provider], enabled } },
    });

  /** Write one field of the track being edited, leaving the other track alone. */
  const patchTrack = (update: Partial<TrackSettings>) =>
    patch({
      tracks: { ...settings.tracks, [editing]: { ...settings.tracks[editing], ...update } },
    });

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Logo className="mt-0.5 size-8" />
          <div>
            <h1 className="text-lg font-semibold">LeetSpacer</h1>
            <p className="text-xs text-ink-muted">
              All data is stored locally in this browser and is never sent anywhere.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={openWelcome}>
          Getting started
        </Button>
      </header>

      <Section
        title="Your history"
        description="Both sites are supported. LeetCode reports when you solved each problem; NeetCode reports only that you did — so LeetCode reviews are dated and NeetCode's are spread."
      >
        <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-3">
          <div className="space-y-1">
            <SourceHeader
              href="https://leetcode.com/problemset/"
              label="leetcode.com"
              enabled={settings.providers.leetcode.enabled}
              onToggle={(enabled) => void patchProvider("leetcode", enabled)}
            />
            <p className="text-xs text-ink-muted">
              Open any page while signed in and your submission history syncs — with real
              solve dates and attempt counts, so reviews are scheduled from when you
              actually solved something. Submitting with a tab open also records the
              verdict as it lands. The first sync walks your whole history and can take a
              few minutes; after that it's a single request.
            </p>
          </div>

          <div className="space-y-1 border-t border-border pt-3">
            <SourceHeader
              href="https://neetcode.io/practice"
              label="neetcode.io/practice"
              enabled={settings.providers.neetcode.enabled}
              onToggle={(enabled) => void patchProvider("neetcode", enabled)}
            />
            <p className="text-xs text-ink-muted">
              Your completed problems sync as you browse. NeetCode records that a problem
              is done but never when, so those seed from the schedule below.
            </p>
          </div>

          <p className="border-t border-border pt-3 text-xs text-ink-subtle">
            Both identify problems by their LeetCode link, so the two merge into one
            history and titles, difficulty and topic tags come from the bundled catalogue.
          </p>

          <Callout title="Why the two schedule differently">
            <p>
              <strong className="font-medium">LeetCode</strong> exposes a timestamp on every submission, so those cards are backfilled with your real solve dates — a problem you last passed in March is scheduled as a problem last seen in March.
            </p>
            <p className="mt-1">
              <strong className="font-medium">NeetCode</strong> reports that a problem is complete but never when, so there is no history to backfill from. LeetSpacer generates its own schedule for those, spread from the day you sync. Change how that spread
              works under Practice tracks below.
            </p>
          </Callout>
        </div>
      </Section>

      <Section
        title="Where problems open"
        description="Which site a problem in the review queue opens on when you click it."
      >
        <fieldset className="space-y-2 rounded-xl border border-border bg-surface-raised p-3">
          <RadioRow
            name="problemLinkTarget"
            checked={settings.problemLinkTarget === "neetcode"}
            label="NeetCode"
            hint="Opens neetcode.io, where the video walkthrough and editorial are. Problems NeetCode doesn't host fall back to LeetCode."
            onSelect={() => void patch({ problemLinkTarget: "neetcode" })}
          />
          <RadioRow
            name="problemLinkTarget"
            checked={settings.problemLinkTarget === "leetcode"}
            label="LeetCode"
            hint="Opens leetcode.com, which has every problem."
            onSelect={() => void patch({ problemLinkTarget: "leetcode" })}
          />
        </fieldset>
      </Section>

      <Section
        title="Practice tracks"
        description="Two independent schedules. Pick one here to adjust how it paces you — the other is untouched."
      >
        <div className="space-y-4 rounded-xl border border-border bg-surface-raised p-3">
          <TrackSwitcher value={editing} onChange={setEditing} />

          <p className="text-xs text-ink-subtle">
            {editing === "leetcode"
              ? "Your full LeetCode submission history. Most of it carries real solve dates, so those cards are already scheduled from when you actually solved them."
              : "Your NeetCode completions. NeetCode records that a problem is done but never when, so every card here is seeded by the strategy below."}
          </p>

          <div className="space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Reviews per day"
                value={track.dailyReviewLimit}
                min={0}
                max={100}
                onChange={(dailyReviewLimit) => void patchTrack({ dailyReviewLimit })}
              />
              <NumberField
                label="New problems per day"
                value={track.dailyNewLimit}
                min={0}
                max={50}
                onChange={(dailyNewLimit) => void patchTrack({ dailyNewLimit })}
              />
            </div>

            <label className="block space-y-1">
              <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                Target retention — {Math.round(track.requestRetention * 100)}%
                <InfoDot label="The share of reviews you want to get right. 90% is the usual balance; higher means seeing each problem more often." />
              </span>
              <input
                type="range"
                className="w-full"
                min={70}
                max={97}
                step={1}
                value={Math.round(track.requestRetention * 100)}
                onChange={(e) =>
                  void patchTrack({ requestRetention: Number(e.target.value) / 100 })
                }
              />
              <span className="block text-xs text-ink-subtle">
                Higher means more frequent reviews.
              </span>
            </label>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
              Scheduling a backlog
              <InfoDot label="Applies only to problems with no real solve date. A LeetCode problem read from your submission history keeps the due date derived from when you actually solved it." />
            </p>

            <fieldset className="space-y-2">
              <RadioRow
                name={`seedStrategy-${editing}`}
                checked={track.seedStrategy === "spread"}
                label="Spread the backlog out"
                hint="Fans problems across a window so a steady few come due each day. Hardest first."
                onSelect={() => void patchTrack({ seedStrategy: "spread" })}
              />
              <RadioRow
                name={`seedStrategy-${editing}`}
                checked={track.seedStrategy === "now"}
                label="Make everything due now"
                hint="The whole backlog is available immediately; the daily limit above is what paces you."
                onSelect={() => void patchTrack({ seedStrategy: "now" })}
              />
            </fieldset>

            {track.seedStrategy === "spread" ? (
              <label className="block space-y-1">
                <span className="block text-xs text-ink-muted">
                  Spread across {track.seedSpreadDays} days
                </span>
                <input
                  type="range"
                  className="w-full"
                  min={1}
                  max={60}
                  step={1}
                  value={track.seedSpreadDays}
                  onChange={(e) => void patchTrack({ seedSpreadDays: Number(e.target.value) })}
                />
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Button variant="primary" onClick={() => void rebuildSchedule(editing)}>
                Apply to the {TRACK_LABELS[editing]} track
              </Button>
              <Tooltip
                label="Problems you've already graded keep their schedule — only untouched ones move, and only in this track."
                align="start"
              >
                <span className="cursor-help text-xs text-ink-subtle underline decoration-dotted underline-offset-2">
                  Reschedules anything you haven't graded yet.
                </span>
              </Tooltip>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Backup and restore">
        <div className="space-y-2 rounded-lg border border-border bg-surface-raised p-3">
          <p className="text-xs text-ink-muted">
            There's no server, so this is how your history moves between browsers or
            survives a wiped profile. Importing merges — it never drops what you already
            have, and review grades are kept.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void exportData()}>
              Export JSON
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Import from file
            </Button>
            <Button variant="ghost" onClick={() => setPasting((open) => !open)}>
              {pasting ? "Cancel paste" : "Paste JSON"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              // Both the extension and the MIME type: some file dialogs grey out .json
              // when only the MIME type is listed.
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then(importJson);
                e.target.value = "";
              }}
            />
          </div>

          {pasting ? (
            <div className="space-y-2">
              <textarea
                className="h-28 w-full rounded-md border border-border bg-surface p-2 font-mono text-[11px]"
                placeholder="Paste the contents of a snapshot JSON file"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <Button
                variant="primary"
                disabled={pasted.trim().length === 0}
                onClick={() => {
                  void importJson(pasted).then(() => {
                    setPasted("");
                    setPasting(false);
                  });
                }}
              >
                Import pasted JSON
              </Button>
            </div>
          ) : null}

          {message ? (
            <Callout tone={failed ? "danger" : "good"}>{message}</Callout>
          ) : null}
        </div>
      </Section>

      <Section title="Start over">
        <div className="space-y-2 rounded-xl border border-border bg-surface-raised p-3">
          <p className="text-xs text-ink-muted">
            Deletes every tracked problem, review card and grade from this browser. Your
            settings above are kept. Afterwards, open neetcode.io/practice and your
            completed problems sync again from scratch.
          </p>
          <p className="text-xs text-ink-subtle">
            Worth doing if your problem count looks wrong — an earlier import can leave
            behind entries keyed by NeetCode's own slugs, which show up alongside the
            LeetCode-keyed ones as duplicates.
          </p>

          {confirmingReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" onClick={() => void resetData()}>
                Yes, delete everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingReset(true)}>
              Reset all data
            </Button>
          )}
        </div>
      </Section>
    </main>
  );
}

function RadioRow({
  name,
  checked,
  label,
  hint,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="radio"
        name={name}
        className="mt-0.5"
        checked={checked}
        onChange={onSelect}
      />
      <span className="min-w-0 text-xs">
        <span className="block font-medium text-ink">{label}</span>
        <span className="block text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-ink-muted">{label}</span>
      <input
        type="number"
        className="w-full rounded-md border border-border bg-surface-raised px-2 py-1"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

function SourceHeader({
  href,
  label,
  enabled,
  onToggle,
}: {
  href: string;
  label: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <a
        className="text-xs font-medium text-accent underline underline-offset-2"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {label}
      </a>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Sync this source
      </label>
    </div>
  );
}
