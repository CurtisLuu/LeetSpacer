import {
  type ProviderId,
  type Settings,
  TRACK_IDS,
  type TrackId,
  type TrackSettings,
  isStorageFull,
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
import { openWelcome } from "../../lib/pages";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  /**
   * The last thing that happened, and where to say it.
   *
   * `where` exists because three different sections report through this one place —
   * rescheduling, import/export, and starting over — and a result rendered under the
   * wrong heading reads as a different operation's outcome.
   */
  const [note, setNote] = useState<{
    text: string;
    failed: boolean;
    where: "schedule" | "data" | "reset";
  } | null>(null);

  const say = useCallback(
    (where: "schedule" | "data" | "reset", text: string, failed = false) =>
      setNote({ text, failed, where }),
    [],
  );
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  /**
   * Which erase is waiting for a yes: one track, everything, or nothing.
   *
   * One value rather than a flag per button, so arming one disarms the others — two
   * primed "delete" buttons on screen at once is how the wrong one gets pressed.
   */
  const [confirming, setConfirming] = useState<TrackId | "all" | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Which track's schedule is being edited. Local, not persisted: it's a view of this
  // page, not a preference, and it shouldn't move the side panel's selector.
  const [editing, setEditing] = useState<TrackId>("neetcode");
  const fileInput = useRef<HTMLInputElement>(null);

  const rebuildSchedule = useCallback(async (track: TrackId) => {
    try {
      const { rebuilt, kept } = await send("schedule:rebuild", { track });
      const inTrack = `in the ${TRACK_LABELS[track]} track`;
      say(
        "schedule",
        kept > 0
          ? `Rescheduled ${rebuilt} problems ${inTrack}. ${kept} already graded, so those were left alone.`
          : `Rescheduled ${rebuilt} problems ${inTrack}.`,
      );
    } catch (error) {
      say("schedule", error instanceof Error ? error.message : String(error), true);
    }
  }, [say]);

  const resetData = useCallback(async () => {
    try {
      await send("data:reset", {});
      setConfirming(null);
      say("reset", "Everything cleared. Open either site to sync again.");
    } catch (error) {
      say("reset", `Reset failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }, [say]);

  /**
   * Erase one site's data, leaving the other exactly as it is.
   *
   * The counts come back from the erase itself rather than being read afterwards: it is
   * the only honest way to say what went, and "cleared" with no number reads as a button
   * that might not have done anything.
   */
  const resetTrack = useCallback(async (track: TrackId) => {
    try {
      const { cleared } = await send("data:reset-track", { track });
      setConfirming(null);
      setSettings(await send("settings:get", {}));
      say(
        "reset",
        `${TRACK_LABELS[track]} cleared: ${cleared.problems} problems, ${cleared.cards} review cards and ${cleared.logs} grades. ` +
          `The ${TRACK_LABELS[other(track)]} track is untouched. Open ${HOSTS[track]} to import it again.`,
      );
    } catch (error) {
      say("reset", `Reset failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }, [say]);

  useEffect(() => {
    void send("settings:get", {})
      .then((loaded) => {
        setSettings(loaded);
        // Open on whatever the side panel is showing — that's the track you were just
        // looking at, and so almost always the one you came here to adjust.
        setEditing(loaded.activeTrack);
      })
      .catch((cause: unknown) => {
        // Without this the page sits on "Loading…" for ever, with nothing said and
        // nothing to press.
        console.error("[lcs] settings unavailable", cause);
        setLoadFailed(true);
      });
  }, []);

  /**
   * Write settings through the background rather than through this page's own connection.
   *
   * One writer, in one place. Both contexts hold their own handle to the same database,
   * and this page saving a whole settings object while the background was recording a
   * sync timestamp meant whichever wrote last silently undid the other — a source
   * switched off here could come back on by itself. It also gets the badge repainted,
   * which this page has no way to do.
   */
  const patch = useCallback(async (update: Partial<Settings>) => {
    setSettings(await send("settings:update", { patch: update }));
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

      // Reported per track rather than as one total. An import can land in either, and
      // the two schedules are separate everywhere else — a single merged figure would be
      // the only place in the interface that pretends otherwise.
      const now = Date.now();
      const summary = await Promise.all(
        TRACK_IDS.map(async (id) => {
          const [tracked, due] = await Promise.all([
            store.cards.count(id),
            store.cards.countDue(id, now),
          ]);
          return `${TRACK_LABELS[id]}: ${tracked} in review, ${due} due now`;
        }),
      );

      say("data", `Imported ${snapshot.problems.length} problems. ${summary.join(". ")}.`);
    } catch (error) {
      say(
        "data",
        isStorageFull(error)
          ? "Import failed: this browser profile is out of storage space. Free some up and try again — nothing was changed."
          : `Import failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }, [say]);

  if (loadFailed) {
    return (
      <main className="mx-auto max-w-xl p-6 text-sm">
        <Callout
          tone="danger"
          title="Couldn't open your settings"
          action={
            <Button variant="secondary" size="sm" onClick={() => location.reload()}>
              Reload
            </Button>
          }
        >
          LeetSpacer couldn't read its own storage. Reload this page; if it keeps
          happening, restart your browser.
        </Callout>
      </main>
    );
  }

  if (!settings) return <main className="p-6 text-sm">Loading…</main>;

  const track = settings.tracks[editing];

  /**
   * Turn one source's sync on or off, leaving the other alone.
   *
   * Sends the one source by name. Sending the whole `providers` map meant sending this
   * page's copy of the *other* source too — a copy read when the page opened, so a sync
   * that finished in the meantime was quietly rolled back by an unrelated toggle.
   */
  const patchProvider = async (provider: ProviderId, enabled: boolean) =>
    setSettings(await send("settings:patch-provider", { provider, patch: { enabled } }));

  /** Write one field of the track being edited, leaving the other track alone. */
  const patchTrack = async (update: Partial<TrackSettings>) =>
    setSettings(await send("settings:patch-track", { track: editing, patch: update }));

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Logo className="mt-0.5 size-8" />
          <h1 className="text-lg font-semibold">LeetSpacer</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={openWelcome}>
          Getting started
        </Button>
      </header>

      <Section
        title="Your history"
        description="Open either site signed in and your progress syncs on its own. Each keeps its own schedule."
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
              Everything you've solved, scheduled from when you actually solved it. The
              first sync takes a few minutes; after that it keeps up as you go. Solving
              with a tab open records the result straight away.
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
              Everything you've completed, with real dates for the problems you solved
              here. Anything you ticked off elsewhere is scheduled using the settings
              below.
            </p>
          </div>

          <p className="border-t border-border pt-3 text-xs text-ink-subtle">
            Turning a source off stops it syncing. Nothing already collected is removed.
          </p>

        </div>
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

          <div className="space-y-2 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
              Minimum lock, in days
              <InfoDot label="The soonest a problem can come back after you rate it. FSRS thinks in flashcards, where ten minutes later is useful; a coding problem re-solved that soon measures nothing. Anything longer than this is left to FSRS." />
            </p>
            <div className="grid grid-cols-3 gap-3">
              {(["Easy", "Medium", "Hard"] as const).map((level) => (
                <NumberField
                  key={level}
                  label={level}
                  value={track.minimumLockDays[level]}
                  min={0}
                  max={60}
                  onChange={(days) =>
                    void patchTrack({
                      minimumLockDays: { ...track.minimumLockDays, [level]: days },
                    })
                  }
                />
              ))}
            </div>
            <p className="text-xs text-ink-subtle">
              Set to 0 to let FSRS schedule freely.
            </p>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
              Scheduling a backlog
              <InfoDot label="Only affects problems with no recorded solve date. Anything with a real date keeps it." />
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

            <StatusNote note={note} where="schedule" />
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

          <StatusNote note={note} where="data" />
        </div>
      </Section>

      <Section title="Start over">
        <div className="space-y-3">
          {/* One track at a time first. The two are separate everywhere else — separate
              history, schedule and grades — so wiping one has to be possible without
              taking the other with it. */}
          {TRACK_IDS.map((id) => (
            <div
              key={id}
              className="space-y-2 rounded-xl border border-border bg-surface-raised p-3"
            >
              <p className="text-xs text-ink-muted">
                <span className="font-medium text-ink">Reset the {TRACK_LABELS[id]} track.</span>{" "}
                Deletes what {TRACK_LABELS[id]} contributed — its problems, its review cards
                and their grades — and nothing from{" "}
                {TRACK_LABELS[other(id)]}. Your settings for it are kept. Open {HOSTS[id]}{" "}
                afterwards and its history imports again from scratch.
              </p>

              {confirming === id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="danger" onClick={() => void resetTrack(id)}>
                    Yes, clear {TRACK_LABELS[id]}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirming(id)}>
                  Reset {TRACK_LABELS[id]} track
                </Button>
              )}
            </div>
          ))}

          <div className="space-y-2 rounded-xl border border-border bg-surface-raised p-3">
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink">Reset everything.</span> Deletes every
              tracked problem, review card and grade from this browser, from both sites.
              Your settings above are kept.
            </p>

            {confirming === "all" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="danger" onClick={() => void resetData()}>
                  Yes, delete everything
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirming("all")}>
                Reset all data
              </Button>
            )}
          </div>

          <StatusNote note={note} where="reset" />
        </div>
      </Section>
    </main>
  );
}

interface Note {
  text: string;
  failed: boolean;
  where: "schedule" | "data" | "reset";
}

/** Shows the last result, but only under the section that produced it. */
function StatusNote({ note, where }: { note: Note | null; where: Note["where"] }) {
  if (!note || note.where !== where) return null;
  return <Callout tone={note.failed ? "danger" : "good"}>{note.text}</Callout>;
}

/** The other one. There are only ever two, which is the point. */
function other(track: TrackId): TrackId {
  return track === "leetcode" ? "neetcode" : "leetcode";
}

const HOSTS: Record<TrackId, string> = {
  leetcode: "leetcode.com",
  neetcode: "neetcode.io",
};

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
