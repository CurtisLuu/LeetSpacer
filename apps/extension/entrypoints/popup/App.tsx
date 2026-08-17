import { Badge, Button, Logo, Stat, TRACK_LABELS, Tooltip, TrackSwitcher } from "../../components/ui";
import { useStatus } from "../../lib/use-status";
import { useTrack } from "../../lib/use-track";

/** Glanceable summary. The side panel is where actual work happens. */
export function App() {
  const { status, refresh } = useStatus(2_000);
  const { track, setTrack } = useTrack();

  const active = track ?? "neetcode";
  const stats = status?.tracks?.[active];
  // The provider behind this track is the one whose tab has to be open for it to sync.
  const connected = status?.providers.find((p) => p.provider === active)?.connected ?? false;

  return (
    <div className="w-64 space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Logo className="size-5" />
          LeetSpacer
        </span>
        <Tooltip
          label={
            connected
              ? `A ${TRACK_LABELS[active]} tab is open, so progress syncs as you browse`
              : `Open ${active === "leetcode" ? "leetcode.com" : "neetcode.io/practice"} to sync`
          }
          align="end"
        >
          <Badge tone={connected ? "good" : "neutral"} dot>
            {connected ? "syncing" : "not connected"}
          </Badge>
        </Tooltip>
      </div>

      <TrackSwitcher
        value={active}
        disabled={track === null}
        due={{
          leetcode: status?.tracks?.leetcode.due ?? 0,
          neetcode: status?.tracks?.neetcode.due ?? 0,
        }}
        onChange={(next) => {
          setTrack(next);
          void refresh();
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <Tooltip label={`Reviews due in the ${TRACK_LABELS[active]} track`} align="start">
          <Stat label="Due" value={stats?.due ?? "—"} tone="accent" className="w-full" />
        </Tooltip>
        <Tooltip label={`Problems ${TRACK_LABELS[active]} says you've solved`} align="end">
          <Stat label="Solved" value={stats?.solved ?? "—"} tone="good" className="w-full" />
        </Tooltip>
      </div>

      <Button
        variant="primary"
        size="lg"
        block
        onClick={() => {
          // The side panel must be opened from a user gesture, in the active window.
          void browser.windows.getCurrent().then((current) => {
            if (current.id !== undefined) void browser.sidePanel.open({ windowId: current.id });
          });
        }}
      >
        Open side panel
      </Button>
    </div>
  );
}
