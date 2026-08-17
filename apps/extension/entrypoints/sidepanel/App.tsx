import { Button, Callout, ProviderCard, Section, Stat, Tooltip } from "../../components/ui";
import { useStatus } from "../../lib/use-status";
import { ReviewQueue } from "./ReviewQueue";

export function App() {
  const { status, error } = useStatus();

  return (
    <div className="flex min-h-screen flex-col gap-5 p-4 text-sm">
      <header>
        <h1 className="text-base font-semibold">LeetCode Spaced</h1>
        <p className="text-xs text-ink-muted">Everything stays on this device.</p>
      </header>

      {error ? (
        <Callout tone="danger" title="Can't reach the background worker">
          {error}
        </Callout>
      ) : null}

      <ReviewQueue />

      <Section title="Collected">
        <div className="grid grid-cols-3 gap-2">
          <Tooltip label="Problems with a review card" align="start">
            <Stat label="Tracked" value={status?.problemsTracked ?? "—"} tone="accent" className="w-full" />
          </Tooltip>
          <Tooltip label="Problems NeetCode says you've completed">
            <Stat label="Solved" value={status?.solved ?? "—"} tone="good" className="w-full" />
          </Tooltip>
          <Tooltip label="Submissions recorded in the append-only log" align="end">
            <Stat label="Events" value={status?.eventsRecorded ?? "—"} tone="info" className="w-full" />
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
