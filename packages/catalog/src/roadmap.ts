import type { RoadmapTopic } from "@lcs/core";

/**
 * The NeetCode roadmap as a DAG.
 *
 * This is what stops the recommender handing someone Advanced Graphs on day three:
 * a topic is only eligible for new-problem recommendations once its prerequisites
 * are mastered.
 */
export interface Roadmap {
  readonly topics: readonly RoadmapTopic[];
  get(id: string): RoadmapTopic | undefined;
  /** Direct prerequisites only. */
  prerequisitesOf(id: string): string[];
  /** Every topic transitively required before `id`. */
  ancestorsOf(id: string): string[];
  /** Dependency order — every topic appears after all of its prerequisites. */
  topologicalOrder(): string[];
  /** Topics whose direct prerequisites are all in `mastered` and that aren't mastered yet. */
  unlocked(mastered: ReadonlySet<string>): string[];
}

export function createRoadmap(topics: readonly RoadmapTopic[]): Roadmap {
  const byId = new Map(topics.map((t) => [t.id, t]));

  for (const topic of topics) {
    for (const prereq of topic.prerequisites) {
      if (!byId.has(prereq)) {
        throw new Error(`Roadmap topic "${topic.id}" lists unknown prerequisite "${prereq}"`);
      }
    }
  }

  const roadmap: Roadmap = {
    topics,

    get: (id) => byId.get(id),

    prerequisitesOf: (id) => [...(byId.get(id)?.prerequisites ?? [])],

    ancestorsOf(id) {
      const seen = new Set<string>();
      const walk = (current: string) => {
        for (const prereq of byId.get(current)?.prerequisites ?? []) {
          if (seen.has(prereq)) continue;
          seen.add(prereq);
          walk(prereq);
        }
      };
      walk(id);
      return [...seen];
    },

    topologicalOrder() {
      const order: string[] = [];
      const state = new Map<string, "visiting" | "done">();

      const visit = (id: string, path: string[]) => {
        const current = state.get(id);
        if (current === "done") return;
        if (current === "visiting") {
          throw new Error(`Roadmap contains a cycle: ${[...path, id].join(" -> ")}`);
        }
        state.set(id, "visiting");
        for (const prereq of byId.get(id)?.prerequisites ?? []) {
          visit(prereq, [...path, id]);
        }
        state.set(id, "done");
        order.push(id);
      };

      for (const topic of topics) visit(topic.id, []);
      return order;
    },

    unlocked(mastered) {
      return topics
        .filter((t) => !mastered.has(t.id) && t.prerequisites.every((p) => mastered.has(p)))
        .map((t) => t.id);
    },
  };

  return roadmap;
}
