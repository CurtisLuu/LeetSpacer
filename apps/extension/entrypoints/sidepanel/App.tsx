import {
  Button,
  Callout,
  ProviderCard,
  Section,
  Stat,
  TRACK_LABELS,
  Tooltip,
  TrackSwitcher,
} from "../../components/ui";
import { useStatus } from "../../lib/use-status";
import { useTrack } from "../../lib/use-track";
import { ReviewQueue } from "./ReviewQueue";

export function App() {
  const { status, error, refresh } = useStatus();
  const { track, setTrack } = useTrack();

  const stats = track ? status?.tracks?.[track] : undefined;

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 text-sm">
      <header className="space-y-3">
        <div>
          <h1 className="text-base font-semibold">LeetSpacer</h1>
          <p className="text-xs text-ink-muted">Everything stays on this device.</p>
        </div>

        <TrackSwitcher
          value={track ?? "neetcode"}
          disabled={track === null}
          due={{
            leetcode: status?.tracks?.leetcode.due ?? 0,
            neetcode: status?.tracks?.neetcode.due ?? 0,
          }}
          onChange={(next) => {
            setTrack(next);
            // The badge follows the active track, and the background is what paints it.
            void refresh();
          }}
        />
      </header>

      {error ? (
        <Callout tone="danger" title="Can't reach the background worker">
          {error}
        </Callout>
      ) : null}

      {/* Keyed on the track so switching remounts the queue rather than showing the
          previous track's rows while the new ones load. */}
      {track ? <ReviewQueue key={track} track={track} /> : null}

      <Section title={track ? `${TRACK_LABELS[track]} track` : "Collected"}>
        <div className="grid grid-cols-3 gap-2">
          <Tooltip label="Problems with a review card in this track" align="start">
            <Stat label="Tracked" value={stats?.tracked ?? "—"} tone="accent" className="w-full" />
          </Tooltip>
          <Tooltip
            label={
              track === "leetcode"
                ? "Problems LeetCode says you've solved"
                : "Problems NeetCode says you've completed"
            }
          >
            <Stat label="Solved" value={stats?.solved ?? "—"} tone="good" className="w-full" />
          </Tooltip>
          <Tooltip
            // Spells out the relationship rather than describing the field, because the
            // number is always higher than Solved and that looks wrong until you know a
            // problem contributes one event per attempt.
            label={
              track === "leetcode"
                ? `${stats?.events ?? 0} submissions across ${stats?.solved ?? 0} solved problems — every attempt counts, including the ones that failed.`
                : `${stats?.events ?? 0} completions, one per problem NeetCode reports done. It has nothing finer to report.`
            }
            align="end"
          >
            <Stat label="Events" value={stats?.events ?? "—"} tone="info" className="w-full" />
          </Tooltip>
        </div>
      </Section>

      <Section title="Sources">
        <div className="space-y-2">
          {status?.providers?.map((provider) => (
            <ProviderCard key={provider.provider} status={provider} />
          )) ?? <p className="text-xs text-ink-muted">Loading…</p>}
        </div>
      </Section>

      <footer className="mt-auto space-y-1 pt-2 text-xs text-ink-subtle">
        <p>
          Catalog:{" "}
          {status?.catalog?.generatedAt
            ? `${status.catalog.count} problems, built ${new Date(status.catalog.generatedAt).toLocaleDateString()}`
            : "not built yet — run pnpm catalog:build"}
        </p>
        <Button variant="link" size="sm" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings
        </Button>
      </footer>
    </div>
  );
}
