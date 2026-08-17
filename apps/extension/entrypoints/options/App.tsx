import { type Settings, parseSnapshot } from "@lcs/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Callout, InfoDot, Section, Tooltip } from "../../components/ui";
import { send } from "../../lib/messaging";
import { getStore } from "../../lib/store";

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const rebuildSchedule = useCallback(async () => {
    try {
      const { rebuilt, kept } = await send("schedule:rebuild", {});
      setFailed(false);
      setMessage(
        kept > 0
          ? `Rescheduled ${rebuilt} problems. ${kept} already graded, so those were left alone.`
          : `Rescheduled ${rebuilt} problems.`,
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
      .then(setSettings);
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
    link.download = `leetcode-spaced-${new Date().toISOString().slice(0, 10)}.json`;
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

      const cards = (await store.cards.all()).length;
      const due = (await store.cards.due(Date.now())).length;
      setFailed(false);
      setMessage(
        `Imported ${snapshot.problems.length} problems and ${snapshot.events.length} submissions. ` +
          `${cards} review cards, ${due} due now.`,
      );
    } catch (error) {
      setFailed(true);
      setMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  if (!settings) return <main className="p-6 text-sm">Loading…</main>;

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6 text-sm">
      <header>
        <h1 className="text-lg font-semibold">LeetCode Spaced</h1>
        <p className="text-xs text-ink-muted">
          All data is stored locally in this browser and is never sent anywhere.
        </p>
      </header>

      <Section title="NeetCode history">
        <div className="space-y-2 rounded-lg border border-border bg-surface-raised p-3">
          <p className="text-xs text-ink-muted">
            Open{" "}
            <a
              className="text-accent underline underline-offset-2"
              href="https://neetcode.io/practice"
              target="_blank"
              rel="noreferrer"
            >
              neetcode.io/practice
            </a>{" "}
            while signed in and your completed problems sync automatically — no button, no
            token. The page already knows what you've finished; the extension just reads it.
          </p>
          <p className="text-xs text-ink-muted">
            Problems are identified by their LeetCode link, so titles, difficulty and topic
            tags come from the bundled catalogue.
          </p>
        </div>
      </Section>

      <Section title="Daily limits">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Reviews per day"
            value={settings.dailyReviewLimit}
            min={0}
            max={100}
            onChange={(dailyReviewLimit) => void patch({ dailyReviewLimit })}
          />
          <NumberField
            label="New problems per day"
            value={settings.dailyNewLimit}
            min={0}
            max={50}
            onChange={(dailyNewLimit) => void patch({ dailyNewLimit })}
          />
        </div>
        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            Target retention — {Math.round(settings.requestRetention * 100)}%
            <InfoDot label="The share of reviews you want to get right. 90% is the usual balance; higher means seeing each problem more often." />
          </span>
          <input
            type="range"
            className="w-full"
            min={70}
            max={97}
            step={1}
            value={Math.round(settings.requestRetention * 100)}
            onChange={(e) => void patch({ requestRetention: Number(e.target.value) / 100 })}
          />
          <span className="block text-xs text-ink-subtle">
            Higher means more frequent reviews.
          </span>
        </label>
      </Section>

      <Section
        title="Review schedule"
        description="NeetCode records that a problem is solved, never when — so this decides how an imported backlog is first scheduled."
      >
        <div className="space-y-3 rounded-xl border border-border bg-surface-raised p-3">
          <fieldset className="space-y-2">
            <RadioRow
              name="seedStrategy"
              checked={settings.seedStrategy === "spread"}
              label="Spread the backlog out"
              hint="Fans problems across a window so a steady few come due each day. Hardest first."
              onSelect={() => void patch({ seedStrategy: "spread" })}
            />
            <RadioRow
              name="seedStrategy"
              checked={settings.seedStrategy === "now"}
              label="Make everything due now"
              hint="The whole backlog is available immediately; the daily limit above is what paces you."
              onSelect={() => void patch({ seedStrategy: "now" })}
            />
          </fieldset>

          {settings.seedStrategy === "spread" ? (
            <label className="block space-y-1">
              <span className="block text-xs text-ink-muted">
                Spread across {settings.seedSpreadDays} days
              </span>
              <input
                type="range"
                className="w-full"
                min={1}
                max={60}
                step={1}
                value={settings.seedSpreadDays}
                onChange={(e) => void patch({ seedSpreadDays: Number(e.target.value) })}
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <Button variant="primary" onClick={() => void rebuildSchedule()}>
              Apply to existing problems
            </Button>
            <Tooltip label="Problems you've already graded keep their schedule — only untouched ones move." align="start">
              <span className="cursor-help text-xs text-ink-subtle underline decoration-dotted underline-offset-2">
                Reschedules anything you haven't graded yet.
              </span>
            </Tooltip>
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
