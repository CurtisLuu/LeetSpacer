import { Stat } from "../../components/ui";
import { useStatus } from "../../lib/use-status";

/** Glanceable summary. The side panel is where actual work happens. */
export function App() {
  const { status } = useStatus(2_000);

  const connected = status?.providers.filter((p) => p.connected).length ?? 0;

  return (
    <div className="w-64 space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">LeetCode Spaced</span>
        <span className="text-[11px] text-[--color-ink-muted]">
          {connected} of 2 connected
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Solved" value={status?.solved ?? "—"} />
        <Stat label="Tracked" value={status?.problemsTracked ?? "—"} />
      </div>

      <button
        type="button"
        className="w-full rounded-md bg-[--color-accent] px-3 py-2 text-xs font-semibold text-[--color-accent-ink]"
        onClick={() => {
          // The side panel must be opened from a user gesture, in the active window.
          void browser.windows.getCurrent().then((current) => {
            if (current.id !== undefined) void browser.sidePanel.open({ windowId: current.id });
          });
        }}
      >
        Open side panel
      </button>
    </div>
  );
}
