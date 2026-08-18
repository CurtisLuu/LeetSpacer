import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PRIVACY_POLICY_VERSION, PRIVACY_REVISIONS } from "./settings.js";

/**
 * Pins `PRIVACY.md` to the revision list.
 *
 * The policy promises that a change is presented before the extension carries on reading.
 * Keeping that promise means remembering to declare a revision when the document changes,
 * and "remembering" is not a mechanism — nothing about editing a markdown file makes the
 * code notice. This is what makes it notice.
 *
 * `pnpm zip` runs the tests, so a policy edit without a declared revision cannot reach a
 * submission build.
 */
const POLICY_PATH = fileURLToPath(new URL("../../../PRIVACY.md", import.meta.url));

const latest = PRIVACY_REVISIONS[PRIVACY_REVISIONS.length - 1]!;

function policyText(): string {
  return readFileSync(POLICY_PATH, "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("PRIVACY.md", () => {
  it("matches the revision declared for it", () => {
    const actual = sha256(policyText());

    // Spelled out rather than left to a bare hash mismatch, because the person reading
    // this failure is mid-release and the fix is not guessable from two hex strings.
    expect(
      actual,
      [
        `PRIVACY.md no longer matches revision ${latest.version}.`,
        "",
        "If you changed the policy, append a revision to PRIVACY_REVISIONS in",
        "packages/core/src/settings.ts:",
        "",
        `  {`,
        `    version: ${latest.version + 1},`,
        `    effective: "<the Effective date at the top of PRIVACY.md>",`,
        `    sha256: "${actual}",`,
        `    // carriesForward: true — only if this revision changes nothing about what`,
        `    // LeetSpacer does with the user's data. Leave it off and everyone re-accepts.`,
        `  }`,
        "",
        "If you did not mean to change the policy, revert PRIVACY.md instead.",
      ].join("\n"),
    ).toBe(latest.sha256);
  });

  it("carries the effective date the revision claims", () => {
    // The date at the top of the document is the version number a reader can actually
    // see, so it has to move with the revision rather than being left behind.
    expect(policyText()).toContain(`Effective ${latest.effective}`);
  });
});

describe("PRIVACY_REVISIONS", () => {
  it("starts at 1 and increases by one", () => {
    // `hasAcceptedPrivacy` compares stored numbers against this list; a gap or a repeat
    // would quietly change who gets asked.
    expect(PRIVACY_REVISIONS.map((r) => r.version)).toEqual(
      PRIVACY_REVISIONS.map((_, index) => index + 1),
    );
  });

  it("is what PRIVACY_POLICY_VERSION reports", () => {
    expect(PRIVACY_POLICY_VERSION).toBe(latest.version);
  });

  it("never carries the first revision forward", () => {
    // There is nothing before it to carry, and marking it would let the checkbox stand in
    // for a first acceptance.
    expect(PRIVACY_REVISIONS[0]?.carriesForward).toBeUndefined();
  });
});
