import { beforeEach, describe, expect, it, vi } from "vitest";

import { type PageObservation, acceptPageBridge, openPageBridge } from "./page-bridge.js";

/**
 * The two worlds meet over a port, and the whole security argument rests on what can and
 * cannot cross it. That is worth testing rather than reasoning about, so `window` is
 * faked here well enough to carry a transferred port between the two ends.
 *
 * Both ends run in this one process, which is exactly the shape of the real thing: two
 * scripts, one document, one channel between them.
 */

type Listener = (event: MessageEvent<unknown>) => void;

interface FakeWindow {
  listeners: Set<Listener>;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  postMessage(data: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  /** Everything a page script would see on the shared bus. */
  seen: { data: unknown; ports: readonly MessagePort[] }[];
}

function fakeWindow(): FakeWindow {
  const listeners = new Set<Listener>();
  const win: FakeWindow = {
    listeners,
    seen: [],
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    postMessage(data, _targetOrigin, transfer) {
      const ports = (transfer ?? []) as MessagePort[];
      win.seen.push({ data, ports });
      const event = {
        data,
        ports,
        source: globalThis.window,
        origin: "https://neetcode.io",
      } as unknown as MessageEvent<unknown>;
      // Dispatched to a copy: `acceptPageBridge` removes its own listener while running.
      for (const listener of [...listeners]) listener(event);
    },
  };
  return win;
}

function observation(overrides: Partial<PageObservation> = {}): PageObservation {
  return {
    provider: "neetcode",
    url: "https://neetcode.io/api/callableFunctionHttp",
    method: "POST",
    status: 200,
    requestBody: '{"data":{"functionId":"getCompletedProblems"}}',
    responseBody: '{"data":{}}',
    authorization: "Bearer live-token",
    observedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Ports deliver asynchronously, as they do in a browser. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let win: FakeWindow;
let warnings: unknown[][];

beforeEach(() => {
  win = fakeWindow();
  warnings = [];
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { origin: "https://neetcode.io" });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
});

describe("the page bridge", () => {
  it("relays observations once, and only after consent", async () => {
    const received: PageObservation[] = [];
    let publish: ((o: PageObservation) => void) | null = null;

    // MAIN world first, as the manifest orders them.
    acceptPageBridge((send) => {
      publish = send;
    });
    const bridge = openPageBridge();
    bridge.onObservation((o) => received.push(o));
    await settle();

    // The MAIN world has a port but no permission: nothing is patched, nothing published.
    expect(publish).toBeNull();

    // It did acknowledge the port, though — that is how "waiting for consent" is told
    // apart from "the handshake never happened".
    expect(warnings).toHaveLength(0);

    bridge.observe();
    await settle();
    expect(publish).not.toBeNull();

    publish!(observation());
    await settle();
    expect(received).toHaveLength(1);
    expect(received[0]?.authorization).toBe("Bearer live-token");
  });

  it("keeps the token off the shared bus", async () => {
    let publish: ((o: PageObservation) => void) | null = null;
    acceptPageBridge((send) => {
      publish = send;
    });
    const bridge = openPageBridge();
    bridge.observe();
    await settle();
    publish!(observation());
    await settle();

    // One window message ever: the port handshake. The observation itself — and the
    // bearer token in it — never touches a bus a page script could listen on.
    expect(win.seen).toHaveLength(1);
    expect(JSON.stringify(win.seen)).not.toContain("live-token");
  });

  it("hands out exactly one port, so a page script cannot ask for another", async () => {
    let accepted = 0;
    acceptPageBridge(() => {
      accepted += 1;
    });
    const first = openPageBridge();
    first.observe();
    await settle();
    expect(accepted).toBe(1);

    // A page script replaying the handshake message, with a port of its own attached.
    const forged = new MessageChannel();
    win.postMessage({ type: "lcs:bridge-port" }, "https://neetcode.io", [
      forged.port2 as unknown as Transferable,
    ]);
    let leaked = false;
    forged.port1.onmessage = () => {
      leaked = true;
    };
    forged.port1.start();
    forged.port1.postMessage({ kind: "observe" });
    await settle();

    expect(accepted).toBe(1);
    expect(leaked).toBe(false);
    forged.port1.close();
  });

  it("drops anything that isn't an observation", async () => {
    const received: PageObservation[] = [];
    let publish: ((o: unknown) => void) | null = null;
    acceptPageBridge((send) => {
      publish = send as (o: unknown) => void;
    });
    const bridge = openPageBridge();
    bridge.onObservation((o) => received.push(o));
    bridge.observe();
    await settle();

    publish!({ provider: "neetcode" });
    publish!(null);
    publish!("two-sum");
    publish!(observation({ status: "200" as unknown as number }));
    await settle();

    expect(received).toHaveLength(0);
  });

  it("ignores an offer that did not come from this window", async () => {
    let accepted = 0;
    acceptPageBridge(() => {
      accepted += 1;
    });

    const channel = new MessageChannel();
    const event = {
      data: { type: "lcs:bridge-port" },
      ports: [channel.port2],
      source: {},
      origin: "https://neetcode.io",
    } as unknown as MessageEvent<unknown>;
    for (const listener of [...win.listeners]) listener(event);
    channel.port1.postMessage({ kind: "observe" });
    await settle();

    expect(accepted).toBe(0);
    channel.port1.close();
    channel.port2.close();
  });
});

describe("a bridge nobody answers", () => {
  it("says so rather than going quiet", async () => {
    vi.useFakeTimers();
    try {
      // No `acceptPageBridge`: the MAIN-world script never ran, or ran too late.
      const bridge = openPageBridge();
      bridge.observe();
      await vi.advanceTimersByTimeAsync(6_000);

      expect(warnings.flat().join(" ")).toContain("never took the port");
    } finally {
      vi.useRealTimers();
    }
  });
});
