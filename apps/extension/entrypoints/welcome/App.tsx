import { type ProviderId, type TrackId } from "@lcs/core";
import { type ReactNode, useState } from "react";

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  ExternalIcon,
  TRACK_LABELS,
  TrackSwitcher,
} from "../../components/ui";
import { cx } from "../../components/cx";
import { useStatus } from "../../lib/use-status";
import { useTrack } from "../../lib/use-track";

/**
 * The page that opens once, on install.
 *
 * The problem it solves: LeetSpacer has nothing to show until history syncs, and history
 * only syncs when you visit a site it reads. A freshly installed extension whose panel
 * says "nothing here" looks broken rather than empty, so the one instruction that matters
 * — go and open one of these two sites — needs to arrive before the panel does.
 *
 * It polls sync status, so the steps tick over as the sync actually lands. Watching the
 * count appear is also the clearest proof the thing works, which is worth more here than
 * any amount of copy claiming it does.
 */
const SOURCES: {
  id: ProviderId;
  name: string;
  href: string;
  blurb: string;
}[] = [
  {
    id: "leetcode",
    name: "LeetCode",
    href: "https://leetcode.com/problemset/",
    blurb:
      "Your submission history, with real solve dates and attempt counts. The first sync walks the whole thing and takes a few minutes.",
  },
  {
    id: "neetcode",
    name: "NeetCode",
    href: "https://neetcode.io/practice",
    blurb:
      "Your completed problems. Reads what the page has already loaded, so it's instant and issues no requests of its own.",
  },
];

export function App() {
  const { status } = useStatus(2_000);
  const { track, setTrack } = useTrack();

  const solvedFor = (provider: ProviderId) => status?.tracks?.[provider]?.solved ?? 0;
  const anySynced = SOURCES.some((source) => solvedFor(source.id) > 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-sm">
      <header className="mb-8">
        <div className="mb-3 flex items-center gap-2.5">
          <Logo />
          <h1 className="text-xl font-semibold">LeetSpacer</h1>
        </div>
        <p className="text-base text-ink-muted">
          Stop re-solving the problems you already know. LeetSpacer schedules reviews from
          your own practice history, so each problem comes back just before you'd forget
          it.
        </p>
      </header>

      <ol className="space-y-4">
        <Step
          n={1}
          title="Connect your history"
          done={anySynced}
          body="Open either site while signed in. Your history syncs on its own — no button, no account, no API token."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {SOURCES.map((source) => {
              const solved = solvedFor(source.id);
              return (
                <Card key={source.id} tone={solved > 0 ? "good" : "default"}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{source.name}</span>
                    {solved > 0 ? (
                      <Badge tone="good" dot>
                        {solved} solved
                      </Badge>
                    ) : (
                      <Badge tone="neutral" dot>
                        waiting
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1.5 text-xs text-ink-muted">{source.blurb}</p>

                  <ButtonLink
                    className="mt-2.5"
                    size="sm"
                    block
                    variant={solved > 0 ? "secondary" : "primary"}
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    icon={<ExternalIcon />}
                  >
                    {solved > 0 ? `Open ${source.name} again` : `Open ${source.name}`}
                  </ButtonLink>
                </Card>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-ink-subtle">
            Leave this tab open — it updates as your history arrives. You only need one of
            the two, and connecting both merges them into a single history.
          </p>
        </Step>

        <Step
          n={2}
          title="Pick where to start"
          done={anySynced}
          body="Two independent schedules. The selector at the top of the side panel switches between them at any time, so this is only a starting point."
        >
          <TrackSwitcher value={track ?? "neetcode"} onChange={setTrack} disabled={track === null} />

          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <TrackBlurb
              track="leetcode"
              active={track === "leetcode"}
              body="Everything you've ever solved, scheduled from when you actually solved it. Usually the larger of the two."
            />
            <TrackBlurb
              track="neetcode"
              active={track === "neetcode"}
              body="Your NeetCode curriculum. Dateless, so it's fanned across a couple of weeks rather than landing all at once."
            />
          </dl>
        </Step>

        <Step
          n={3}
          title="Review"
          body="Click the LeetSpacer icon in your toolbar whenever the badge shows a number. Rate each problem from memory before you open it — the rating is what schedules the next one."
        >
          <Button
            variant="primary"
            onClick={() => {
              // Needs a user gesture and a window id; both hold inside a click handler on
              // a real tab. If Chrome declines anyway the instruction above still stands.
              void browser.windows
                .getCurrent()
                .then((current) => {
                  if (current.id !== undefined) {
                    return browser.sidePanel.open({ windowId: current.id });
                  }
                  return undefined;
                })
                .catch(() => {});
            }}
          >
            Open the side panel
          </Button>
        </Step>
      </ol>

      <footer className="mt-8 border-t border-border pt-5 text-xs text-ink-subtle">
        <p className="mb-1.5 font-medium text-ink-muted">
          Everything stays on this device.
        </p>
        <p>
          There is no server and no account. LeetSpacer reads your history from a script
          running on leetcode.com and neetcode.io using the session you're already signed
          in with — it never handles a password or a token, and nothing is transmitted
          anywhere.{" "}
          <a
            className="text-accent underline underline-offset-2"
            href="https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md"
            target="_blank"
            rel="noreferrer"
          >
            Privacy policy
          </a>
          .
        </p>
        <p className="mt-2.5">
          <Button variant="link" size="sm" onClick={() => void browser.runtime.openOptionsPage()}>
            Settings
          </Button>
        </p>
      </footer>
    </main>
  );
}

function Step({
  n,
  title,
  body,
  done = false,
  children,
}: {
  n: number;
  title: string;
  body: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="mb-2 flex items-center gap-2.5">
        <span
          className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done ? "bg-good-soft text-good" : "bg-accent-soft text-accent",
          )}
          aria-hidden
        >
          {done ? <CheckIcon className="size-3.5" /> : n}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>

      <p className="mb-3 text-xs text-ink-muted">{body}</p>
      {children}
    </li>
  );
}

function TrackBlurb({
  track,
  active,
  body,
}: {
  track: TrackId;
  active: boolean;
  body: string;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border p-2.5",
        active ? "border-accent/30 bg-accent-soft" : "border-border bg-surface",
      )}
    >
      <dt className="font-medium text-ink">{TRACK_LABELS[track]}</dt>
      <dd className="mt-0.5 text-ink-muted">{body}</dd>
    </div>
  );
}

/** The extension's own mark, inline so the page needs no image request. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-accent" />
      <circle cx="6.7" cy="16" r="1.8" className="fill-accent-ink" />
      <circle cx="13.8" cy="16" r="2.5" className="fill-accent-ink" />
      <circle cx="23.7" cy="16" r="3.4" className="fill-accent-ink" />
    </svg>
  );
}
