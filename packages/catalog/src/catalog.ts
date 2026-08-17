import type { Difficulty, Problem, RoadmapTopic } from "@lcs/core";

import { type Roadmap, createRoadmap } from "./roadmap.js";

/** Indexed, read-only view of the bundled dataset. */
export interface Catalog {
  readonly problems: readonly Problem[];
  readonly roadmap: Roadmap;
  /** When `build:data` last regenerated problems.json; null if it never has. */
  readonly generatedAt: string | null;
  bySlug(slug: string): Problem | undefined;
  byTopicTag(tag: string): readonly Problem[];
  byRoadmapTopic(topicId: string): readonly Problem[];
  byList(list: string): readonly Problem[];
  byDifficulty(difficulty: Difficulty): readonly Problem[];
  /** All topic tags present in the dataset, most common first. */
  topicTags(): string[];
}

export interface CatalogData {
  generatedAt: string | null;
  problems: Problem[];
}

export function createCatalog(data: CatalogData, topics: readonly RoadmapTopic[]): Catalog {
  const { problems } = data;
  const bySlug = new Map(problems.map((p) => [p.slug, p]));

  const groupBy = (key: (p: Problem) => string[]) => {
    const index = new Map<string, Problem[]>();
    for (const problem of problems) {
      for (const value of key(problem)) {
        const bucket = index.get(value);
        if (bucket) bucket.push(problem);
        else index.set(value, [problem]);
      }
    }
    return index;
  };

  const byTag = groupBy((p) => p.topicTags);
  const byTopic = groupBy((p) => (p.roadmapTopic ? [p.roadmapTopic] : []));
  const byList = groupBy((p) => p.lists);
  const byDifficulty = groupBy((p) => [p.difficulty]);

  return {
    problems,
    roadmap: createRoadmap(topics),
    generatedAt: data.generatedAt,
    bySlug: (slug) => bySlug.get(slug),
    byTopicTag: (tag) => byTag.get(tag) ?? [],
    byRoadmapTopic: (topicId) => byTopic.get(topicId) ?? [],
    byList: (list) => byList.get(list) ?? [],
    byDifficulty: (difficulty) => byDifficulty.get(difficulty) ?? [],
    topicTags: () =>
      [...byTag.entries()].sort((a, b) => b[1].length - a[1].length).map(([tag]) => tag),
  };
}
