import { ProviderCard, Section, Stat } from "../../components/ui";
import { useStatus } from "../../lib/use-status";
import { ReviewQueue } from "./ReviewQueue";

/**
 * The main surface. P1 shows connection state and what has been collected so far;
 * P3 replaces the placeholder with the actual review queue.
 */
export function App() {
  const { status, error } = useStatus();

  return (
    <div className="flex min-h-screen flex-col gap-5 p-4 text-sm">
      <header>
        <h1 className="text-base font-semibold">LeetCode Spaced</h1>
        <p className="text-xs text-[--color-ink-muted]">
          Everything stays on this device.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg border border-[--color-border] p-3 text-xs text-[--color-warn]">
          Can't reach the background worker: {error}
        </p>
      ) : null}

      <ReviewQueue />

      <Section title="Collected">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Tracked" value={status?.problemsTracked ?? "—"} />
          <Stat label="Solved" value={status?.solved ?? "—"} />
          <Stat label="Events" value={status?.eventsRecorded ?? "—"} />
        </div>
      </Section>

      <Section title="Sources">
        <div className="space-y-2">
          {status?.providers?.map((provider) => (
            <ProviderCard key={provider.provider} status={provider} />
          )) ?? <p className="text-xs text-[--color-ink-muted]">Loading…</p>}
        </div>
      </Section>


      <footer className="mt-auto space-y-1 pt-2 text-[11px] text-[--color-ink-muted]">
        <p>
          Catalog:{" "}
          {status?.catalog?.generatedAt
            ? `${status.catalog.count} problems, built ${new Date(status.catalog.generatedAt).toLocaleDateString()}`
            : "not built yet — run pnpm catalog:build"}
        </p>
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </footer>
    </div>
  );
}
