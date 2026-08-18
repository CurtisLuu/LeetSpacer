import { type ProviderId, type TrackId } from "@lcs/core";
import { type ReactNode, useState } from "react";

import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CheckIcon,
  ExternalIcon,
  Logo,
  TRACK_LABELS,
  Wordmark,
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
      "Everything you've solved, scheduled from when you actually solved it. The first sync takes a few minutes.",
  },
  {
    id: "neetcode",
    name: "NeetCode",
    href: "https://neetcode.io/practice",
    blurb:
      "Everything you've completed, with real dates for the problems you solved here. The first sync takes a minute or two.",
  },
];

export function App() {
  const { status } = useStatus(2_000);
  const { track, setTrack } = useTrack();

  const solvedFor = (provider: ProviderId) => status?.tracks?.[provider]?.solved ?? 0;
  const anySynced = SOURCES.some((source) => solvedFor(source.id) > 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-sm">
      <header className="mb-7 flex items-center gap-3">
        <Logo className="size-11" />
        <div>
          <h1>
            <Wordmark className="text-2xl" />
          </h1>
          <p className="text-xs text-ink-subtle">spaced repetition for leetcode</p>
        </div>
      </header>

      <ol className="space-y-4">
        <Step
          n={1}
          title="Connect your history"
          done={anySynced}
          body="Open either site while signed in. Your history syncs on its own."
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
            the two, and each keeps its own schedule.
          </p>
        </Step>

        <Step
          n={2}
          title="Pick where to start"
          done={anySynced}
          body="Both sites are supported and keep separate schedules. Switch tracks any time from the top of the side panel."
        >
          <TrackSwitcher value={track ?? "neetcode"} onChange={setTrack} disabled={track === null} />

          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <TrackBlurb
              track="leetcode"
              active={track === "leetcode"}
              body="Your whole history, usually the larger of the two."
            />
            <TrackBlurb
              track="neetcode"
              active={track === "neetcode"}
              body="The NeetCode curriculum, paced separately from the above."
            />
          </dl>

        </Step>

        <Step
          n={3}
          title="Review"
          body="Click the LeetSpacer icon in your toolbar whenever the badge shows a number. Open each problem, solve it, then come back and rate how it went — that rating is what decides when you see it again."
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

          <p className="mt-3 text-xs text-ink-subtle">
            The queue hands you a fixed batch for the day rather than refilling as you work
            through it. <strong className="font-medium">Browse all</strong>, on the track
            panel, lists everything else with a countdown to when each one unlocks.
          </p>
        </Step>
      </ol>

      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-xs">
        <Button variant="link" size="sm" onClick={() => void browser.runtime.openOptionsPage()}>
          Settings
        </Button>
        <a
          className="text-accent underline underline-offset-2"
          href="https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md"
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy
        </a>
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
