import type { ProviderId } from "./model.js";

/**
 * Why a sync stopped, in terms a person can act on.
 *
 * Adapters fail in a hundred ways — an HTTP status, a shape that didn't parse, a token
 * that aged out, a missing asset — and almost none of those are worth showing anyone. The
 * raw detail belongs in the console, where whoever is debugging can find it. This is the
 * short list of things a *user* can actually do something about, and every failure is
 * classified into one of them before it reaches the interface.
 */
export type SyncFailure =
  /** Nobody is signed in on the site, so there is nothing to read. */
  | "signed-out"
  /** There was a session, and it aged out mid-read. Reloading the site fixes it. */
  | "session-expired"
  /** The site didn't answer. Network, outage, or a block. */
  | "unreachable"
  /** It answered with something unrecognizable — the site changed under us. */
  | "site-changed"
  /** The extension is missing data it ships with. Reinstalling fixes it. */
  | "not-ready"
  /** Genuinely unclassified. Deliberately last resort. */
  | "unknown";

export interface UserMessage {
  title: string;
  /** One sentence, plain, and always ending in something the reader can do. */
  detail: string;
}

const SITE_NAMES: Record<ProviderId, string> = {
  leetcode: "LeetCode",
  neetcode: "NeetCode",
};

const SITE_HOSTS: Record<ProviderId, string> = {
  leetcode: "leetcode.com",
  neetcode: "neetcode.io",
};

/**
 * The message shown on a provider card.
 *
 * Says what happened and what to do, and nothing about how the extension is built —
 * an endpoint name or an HTTP status tells the reader nothing they can act on.
 */
export function describeSyncFailure(failure: SyncFailure, provider: ProviderId): UserMessage {
  const name = SITE_NAMES[provider];
  const host = SITE_HOSTS[provider];

  switch (failure) {
    case "signed-out":
      return {
        title: `Not signed in to ${name}`,
        detail: `Sign in at ${host} and leave the tab open for a moment.`,
      };
    case "session-expired":
      return {
        title: `${name} sign-in expired`,
        detail: `Reload ${host} and leave the tab open for a moment.`,
      };
    case "unreachable":
      return {
        title: `Couldn't reach ${name}`,
        detail: `Check your connection, then open ${host} again.`,
      };
    case "site-changed":
      return {
        title: `Couldn't read your ${name} history`,
        detail: `${name} has changed how it reports progress. An update to LeetSpacer will be needed.`,
      };
    case "not-ready":
      return {
        title: "LeetSpacer isn't ready",
        detail: "Some of its data is missing. Reinstalling the extension will restore it.",
      };
    case "unknown":
      return {
        title: `Couldn't finish syncing ${name}`,
        detail: `Open ${host} again to retry.`,
      };
  }
}
