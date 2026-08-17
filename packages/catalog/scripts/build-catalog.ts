/**
 * Regenerates `data/problems.json` from LeetCode's public problem list.
 *
 * This is a *developer* build step, not something the extension does at runtime:
 * the dataset ships bundled so users never generate traffic just to see what
 * problems exist. Paginated and rate-limited on purpose.
 *
 * Usage: pnpm catalog:build
 *
 * List membership (blind75 / neetcode150) and roadmap topics are intentionally left
 * empty here — neetcode.io is the authority for those, and the P4 adapter fills them
 * in rather than us hardcoding a list that silently drifts.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Difficulty, Problem } from "@lcs/core";

const ENDPOINT = "https://leetcode.com/graphql/";
const PAGE_SIZE = 100;
const DELAY_MS = 600;
const MAX_PAGES = 100;

const QUERY = `
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      acRate
      difficulty
      frontendQuestionId: questionFrontendId
      paidOnly: isPaidOnly
      title
      titleSlug
      topicTags { slug }
    }
  }
}`;

interface RawQuestion {
  acRate: number;
  difficulty: string;
  frontendQuestionId: string;
  paidOnly: boolean;
  title: string;
  titleSlug: string;
  topicTags: { slug: string }[];
}

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../data/problems.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toProblem(raw: RawQuestion): Problem {
  const difficulty = raw.difficulty as Difficulty;
  if (difficulty !== "Easy" && difficulty !== "Medium" && difficulty !== "Hard") {
    throw new Error(`Unexpected difficulty "${raw.difficulty}" for ${raw.titleSlug}`);
  }
  return {
    slug: raw.titleSlug,
    lcId: Number.parseInt(raw.frontendQuestionId, 10),
    title: raw.title,
    difficulty,
    topicTags: raw.topicTags.map((t) => t.slug),
    // LeetCode reports acRate as a percentage; the model stores 0..1.
    acRate: raw.acRate / 100,
    isPaidOnly: raw.paidOnly,
    lists: [],
    roadmapTopic: null,
    companyFreq: {},
  };
}

async function fetchPage(skip: number): Promise<{ total: number; questions: RawQuestion[] }> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Identify the tool rather than impersonating a browser.
      "user-agent": "leetspacer-catalog-builder (dev build script)",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { categorySlug: "", limit: PAGE_SIZE, skip, filters: {} },
    }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode returned HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as {
    data?: { problemsetQuestionList?: { total: number; questions: RawQuestion[] } };
    errors?: { message: string }[];
  };

  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  const page = body.data?.problemsetQuestionList;
  if (!page) {
    throw new Error(
      "Response had no problemsetQuestionList. LeetCode's schema has probably changed — " +
        "re-capture the query from the network tab and update QUERY in this script.",
    );
  }

  return page;
}

async function main() {
  const problems: Problem[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let page = 0; page < MAX_PAGES && problems.length < total; page++) {
    const skip = page * PAGE_SIZE;
    const { total: reported, questions } = await fetchPage(skip);
    total = reported;

    if (questions.length === 0) break;
    problems.push(...questions.map(toProblem));
    process.stdout.write(`\rfetched ${problems.length}/${total}`);

    if (problems.length < total) await sleep(DELAY_MS);
  }

  process.stdout.write("\n");

  if (problems.length === 0) {
    throw new Error("Fetched zero problems; refusing to overwrite the existing catalog.");
  }

  problems.sort((a, b) => a.lcId - b.lcId);
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), problems }, null, 0)}\n`,
  );

  console.log(`wrote ${problems.length} problems to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(`\ncatalog build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
