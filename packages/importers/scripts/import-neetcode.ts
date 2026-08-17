/**
 * Turn a NeetCode GitHub Sync checkout into a snapshot the extension can import.
 *
 *   pnpm import:neetcode <path-to-repo> [--out snapshot.json]
 *
 * Then load the file with Import JSON on the extension's options page.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildSnapshot } from "../src/index.js";
import { readNeetcodeRepo } from "../src/node.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out" || arg === "-o") {
      out = argv[++i] ?? null;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else {
      positional.push(arg);
    }
  }

  return { repoPath: positional[0], out };
}

/** Local date, not UTC — an evening solve shouldn't be reported as the next day. */
function formatDate(at: number | null): string {
  if (at === null) return "—";
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

async function main() {
  const { repoPath, out } = parseArgs(process.argv.slice(2));

  if (!repoPath) {
    console.error("usage: pnpm import:neetcode <path-to-neetcode-submissions> [--out file.json]");
    process.exitCode = 1;
    return;
  }

  const submissions = readNeetcodeRepo(repoPath);
  const now = Date.now();
  const { snapshot, summary } = buildSnapshot(submissions, { now });

  const outputPath = resolve(out ?? "neetcode-snapshot.json");
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const struggled = snapshot.problems.filter((problem) => problem.attempts >= 3);

  console.log(`
  problems       ${summary.problems}
  submissions    ${summary.submissions}
  solve range    ${formatDate(summary.earliestSolve)} → ${formatDate(summary.latestSolve)}
  cards seeded   ${summary.cardsSeeded}
  due right now  ${summary.dueNow}
  3+ attempts    ${struggled.length}${struggled.length ? ` (${struggled.map((p) => p.slug).join(", ")})` : ""}

  wrote ${outputPath}
  Load it with Import JSON on the extension's options page.
`);
}

main().catch((error: unknown) => {
  console.error(`import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
