import type { RoadmapTopic } from "@lcs/core";
import { describe, expect, it } from "vitest";

import { createRoadmap } from "./roadmap.js";
import { ROADMAP_TOPICS } from "./index.js";

const LINE: RoadmapTopic[] = [
  { id: "a", title: "A", prerequisites: [] },
  { id: "b", title: "B", prerequisites: ["a"] },
  { id: "c", title: "C", prerequisites: ["b"] },
];

describe("createRoadmap", () => {
  it("rejects a prerequisite that isn't a known topic", () => {
    expect(() =>
      createRoadmap([{ id: "b", title: "B", prerequisites: ["missing"] }]),
    ).toThrow(/unknown prerequisite "missing"/);
  });

  it("detects cycles instead of hanging", () => {
    const cyclic = createRoadmap([
      { id: "a", title: "A", prerequisites: ["b"] },
      { id: "b", title: "B", prerequisites: ["a"] },
    ]);

    expect(() => cyclic.topologicalOrder()).toThrow(/cycle/);
  });

  it("collects transitive prerequisites", () => {
    expect(createRoadmap(LINE).ancestorsOf("c").sort()).toEqual(["a", "b"]);
  });

  it("unlocks only topics whose direct prerequisites are mastered", () => {
    const roadmap = createRoadmap(LINE);

    expect(roadmap.unlocked(new Set())).toEqual(["a"]);
    expect(roadmap.unlocked(new Set(["a"]))).toEqual(["b"]);
    expect(roadmap.unlocked(new Set(["a", "b"]))).toEqual(["c"]);
  });
});

describe("the shipped NeetCode roadmap", () => {
  const roadmap = createRoadmap(ROADMAP_TOPICS);

  it("is a valid DAG", () => {
    expect(() => roadmap.topologicalOrder()).not.toThrow();
    expect(roadmap.topologicalOrder()).toHaveLength(ROADMAP_TOPICS.length);
  });

  it("starts a new user at Arrays & Hashing and nothing else", () => {
    expect(roadmap.unlocked(new Set())).toEqual(["arrays-hashing"]);
  });

  it("orders every topic after its prerequisites", () => {
    const order = roadmap.topologicalOrder();
    for (const topic of ROADMAP_TOPICS) {
      for (const prereq of topic.prerequisites) {
        expect(order.indexOf(prereq)).toBeLessThan(order.indexOf(topic.id));
      }
    }
  });
});
