import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory-store.js";
import { parseSnapshot } from "./snapshot.js";

const VALID = {
  version: 1,
  exportedAt: 1_786_929_717_000,
  events: [],
  problems: [],
  cards: [],
  logs: [],
  settings: {},
};

describe("parseSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(parseSnapshot(JSON.stringify(VALID)).version).toBe(1);
  });

  it("round-trips what the store exports", async () => {
    const store = createMemoryStore();
    const exported = await store.exportSnapshot();

    expect(() => parseSnapshot(JSON.stringify(exported))).not.toThrow();
  });

  it("names the problem when the file isn't JSON", () => {
    expect(() => parseSnapshot("not json at all")).toThrow(/isn't valid JSON/);
  });

  it("rejects JSON that isn't an object", () => {
    expect(() => parseSnapshot("[1,2,3]")).toThrow(/isn't an object/);
    expect(() => parseSnapshot("42")).toThrow(/isn't an object/);
  });

  it("recognises a capture export and says so", () => {
    const captures = JSON.stringify({ capturedAt: 1, records: [{ id: "x" }] });

    expect(() => parseSnapshot(captures)).toThrow(/capture-mode export/);
  });

  it("reports an unexpected version rather than importing it", () => {
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: 2 }))).toThrow(/found 2/);
    expect(() => parseSnapshot(JSON.stringify({ ...VALID, version: undefined }))).toThrow(
      /version 1/,
    );
  });

  it("requires each list to be present", () => {
    for (const key of ["events", "problems", "cards", "logs"]) {
      const broken = JSON.stringify({ ...VALID, [key]: undefined });
      expect(() => parseSnapshot(broken)).toThrow(new RegExp(`"${key}"`));
    }
  });
});
