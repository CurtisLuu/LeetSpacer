import { describe, expect, it } from "vitest";

import neetcodeSlugData from "../data/neetcode-slugs.json" with { type: "json" };
import { bundledCatalog } from "./index.js";
import {
  type NeetcodeSlugData,
  createProblemLinks,
  leetcodeUrl,
  neetcodeUrl,
} from "./problem-links.js";

const links = createProblemLinks(neetcodeSlugData as NeetcodeSlugData);

describe("createProblemLinks", () => {
  it("translates renamed problems to NeetCode's own slug", () => {
    // The whole reason this file exists: NeetCode renamed these, so linking with the
    // LeetCode slug would 404.
    expect(links.neetcodeSlug("two-sum")).toBe("two-integer-sum");
    expect(links.neetcodeSlug("valid-anagram")).toBe("is-anagram");
    expect(links.neetcodeSlug("contains-duplicate")).toBe("duplicate-integer");
    expect(links.neetcodeSlug("reorder-list")).toBe("reorder-linked-list");
  });

  it("keeps the LeetCode slug where NeetCode didn't rename it", () => {
    // The majority case — NeetCode renamed only its NC150-era problems.
    expect(links.neetcodeSlug("accounts-merge")).toBe("accounts-merge");
    expect(links.neetcodeSlug("add-binary")).toBe("add-binary");
  });

  it("resolves to NeetCode when preferred and hosted", () => {
    expect(links.resolve("two-sum", "neetcode")).toEqual({
      href: "https://neetcode.io/problems/two-integer-sum",
      site: "neetcode",
      fellBack: false,
    });
  });

  it("falls back to LeetCode for problems NeetCode doesn't host", () => {
    expect(links.neetcodeSlug("132-pattern")).toBeNull();
    expect(links.resolve("132-pattern", "neetcode")).toEqual({
      href: "https://leetcode.com/problems/132-pattern/",
      site: "leetcode",
      fellBack: true,
    });
  });

  it("never reports a fallback when LeetCode was the ask", () => {
    const resolved = links.resolve("two-sum", "leetcode");
    expect(resolved).toEqual({
      href: "https://leetcode.com/problems/two-sum/",
      site: "leetcode",
      fellBack: false,
    });
  });

  it("translates a NeetCode slug back to LeetCode's", () => {
    // NeetCode's submission records identify problems this way round.
    expect(links.leetcodeSlug("two-integer-sum")).toBe("two-sum");
    expect(links.leetcodeSlug("duplicate-integer")).toBe("contains-duplicate");
    expect(links.leetcodeSlug("not-a-neetcode-problem")).toBeNull();
  });

  it("hands over the whole table for callers that can't reach the catalog", () => {
    // A content script can't fetch an extension asset, so the background ships this.
    const table = links.neetcodeToLeetcode();

    expect(Object.keys(table)).toHaveLength(links.size);
    expect(table["three-integer-sum"]).toBe("3sum");
    // Round-trips with the forward lookup, or the two would drift.
    for (const [nc, lc] of Object.entries(table)) expect(links.neetcodeSlug(lc)).toBe(nc);
  });

  it("degrades to LeetCode when the map is empty", () => {
    const empty = createProblemLinks({ generatedAt: null, bySlug: {} });
    expect(empty.size).toBe(0);
    expect(empty.resolve("two-sum", "neetcode").site).toBe("leetcode");
  });

  it("builds well-formed URLs", () => {
    expect(leetcodeUrl("two-sum")).toBe("https://leetcode.com/problems/two-sum/");
    expect(neetcodeUrl("two-integer-sum")).toBe("https://neetcode.io/problems/two-integer-sum");
  });
});

describe("the generated map", () => {
  it("covers a useful share of NeetCode's catalogue", () => {
    expect(links.size).toBeGreaterThan(400);
  });

  it("only maps slugs that exist in the problem catalog", () => {
    // A mapping keyed by a slug we don't know about can never be looked up, and means
    // the two build steps have drifted apart.
    const catalog = bundledCatalog();
    const unknown = Object.keys((neetcodeSlugData as NeetcodeSlugData).bySlug).filter(
      (slug) => catalog.bySlug(slug) === undefined,
    );
    expect(unknown).toEqual([]);
  });

  it("maps each NeetCode slug at most once", () => {
    const ncSlugs = Object.values((neetcodeSlugData as NeetcodeSlugData).bySlug);
    expect(new Set(ncSlugs).size).toBe(ncSlugs.length);
  });
});
