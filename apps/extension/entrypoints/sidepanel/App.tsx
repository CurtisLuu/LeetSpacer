import {
  Button,
  Callout,
  Logo,
  ProviderCard,
  Section,
  Stat,
  TRACK_LABELS,
  Tooltip,
  TrackSwitcher,
} from "../../components/ui";
import { openProblems } from "../../lib/pages";
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
        <div className="flex items-center gap-2">
          <Logo className="size-7" />
          <h1 className="min-w-0 truncate text-base font-semibold">LeetSpacer</h1>
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
        <Callout tone="danger" title="LeetSpacer isn't responding">
          Close and reopen this panel. If it keeps happening, restart your browser.
        </Callout>
      ) : null}

      {/* Keyed on the track so switching remounts the queue rather than showing the
          previous track's rows while the new ones load. */}
      {track ? <ReviewQueue key={track} track={track} /> : null}

      <Section
        title={track ? `${TRACK_LABELS[track]} track` : "Collected"}
        action={
          <Button variant="ghost" size="sm" onClick={openProblems}>
            Browse all
          </Button>
        }
      >
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
            // Always higher than Solved, which looks wrong until you know a problem you
            // struggled with counts more than once.
            label={`Every attempt you've made, including the ones that didn't pass`}
            align="end"
          >
            <Stat label="Attempts" value={stats?.events ?? "—"} tone="info" className="w-full" />
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
            ? `${status.catalog.count} problems, updated ${new Date(status.catalog.generatedAt).toLocaleDateString()}`
            : "unavailable"}
        </p>
        <Button variant="link" size="sm" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings
        </Button>
      </footer>
    </div>
  );
}
