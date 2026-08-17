import { Badge, Button, Stat, Tooltip } from "../../components/ui";
import { useStatus } from "../../lib/use-status";

/** Glanceable summary. The side panel is where actual work happens. */
export function App() {
  const { status } = useStatus(2_000);
  const connected = status?.providers.some((provider) => provider.connected) ?? false;

  return (
    <div className="w-64 space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">LeetCode Spaced</span>
        <Tooltip
          label={
            connected
              ? "A neetcode.io tab is open, so progress syncs as you browse"
              : "Open neetcode.io/practice to sync your completed problems"
          }
          align="end"
        >
          <Badge tone={connected ? "good" : "neutral"} dot>
            {connected ? "syncing" : "not connected"}
          </Badge>
        </Tooltip>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tooltip label="Problems NeetCode says you've completed" align="start">
          <Stat label="Solved" value={status?.solved ?? "—"} tone="good" className="w-full" />
        </Tooltip>
        <Tooltip label="Problems with a review card" align="end">
          <Stat label="Tracked" value={status?.problemsTracked ?? "—"} tone="accent" className="w-full" />
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
