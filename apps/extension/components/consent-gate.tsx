import type { ReactNode } from "react";

import { Button } from "./button";
import { Logo } from "./logo";
import { useConsent } from "../lib/use-consent";

const POLICY_URL = "https://github.com/CurtisLuu/LeetSpacer/blob/main/PRIVACY.md";

/**
 * Covers whatever it wraps until the privacy policy is accepted.
 *
 * Deliberately not dismissible: no close button, no escape, no clicking the backdrop.
 * It is a gate rather than a notice, and a gate you can wave past is a notice.
 *
 * The content behind it is marked `inert`, so it can't be tabbed into or read out from
 * underneath the dialog — a visual cover on its own leaves the whole interface reachable
 * by keyboard.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { accepted, accept } = useConsent();

  // `null` means we haven't looked yet. Rendering the gate during that moment would
  // flash a consent screen at someone who accepted months ago.
  if (accepted !== false) return <>{children}</>;

  return (
    <>
      <div inert aria-hidden="true">
        {children}
      </div>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lcs-consent-title"
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-surface-sunken/85 p-4 backdrop-blur-sm"
      >
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
          <div className="mb-3 flex items-center gap-2.5">
            <Logo className="size-8" />
            <h1 id="lcs-consent-title" className="text-base font-semibold">
              Before you start
            </h1>
          </div>

          <p className="text-xs text-ink-muted">
            LeetSpacer reads your practice history from LeetCode and NeetCode to work out
            what to show you. All of it stays on this device — there is no account, no
            server, and nothing is ever sent anywhere.
          </p>
          <p className="mt-2 text-xs font-medium text-ink">
            Nothing is read until you accept.
          </p>

          <Button className="mt-4" variant="primary" block onClick={accept}>
            Accept and continue
          </Button>

          <a
            className="mt-2.5 block text-center text-xs text-accent underline underline-offset-2"
            href={POLICY_URL}
            target="_blank"
            rel="noreferrer"
          >
            Read the privacy policy
          </a>

          {/* Says when this comes back, so accepting doesn't feel like signing away the
              right to be told. There is no "don't show me again" to offer: accepting is
              already that, and what brings the screen back is our call about a revision,
              not a preference anyone can set here. */}
          <p className="mt-3 text-center text-xs text-ink-subtle">
            You won't see this again unless the privacy policy changes what LeetSpacer
            does with your data.
          </p>
        </div>
      </div>
    </>
  );
}
