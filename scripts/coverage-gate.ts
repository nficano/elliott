#!/usr/bin/env bun
/**
 * Aggregate coverage gate (no-regression ratchet).
 *
 * Runs the full test suite under coverage, then compares the *weighted
 * project aggregate* (parsed from coverage/lcov.info) against a floor.
 *
 * Why a script and not bunfig's `coverageThreshold`: Bun enforces
 * `coverageThreshold` per-file, so it cannot express a project-wide gate —
 * individual files sit well below the aggregate. This computes the true
 * weighted total (lines/functions hit over found) across repo source.
 *
 * The floor tracks current coverage; the target is 90%. Raise MIN_LINES_PCT /
 * MIN_FUNCS_PCT as coverage improves — never lower them. Run via
 * `bun run test:coverage`; enforced on push by .githooks/pre-push (bypass an
 * emergency push with `git push --no-verify`).
 */

import process from "node:process";

const PERCENT = 100;
const LABEL_WIDTH = 10;
const MIN_LINES_PCT = 80;
const MIN_FUNCS_PCT = 80;
const TARGET_PCT = 90;
const LCOV_PATH = "coverage/lcov.info";

type Totals = {
  linesFound: number;
  linesHit: number;
  funcsFound: number;
  funcsHit: number;
};

const SF_PREFIX = "SF:";
const METRICS = [
  { prefix: "LF:", key: "linesFound" },
  { prefix: "LH:", key: "linesHit" },
  { prefix: "FNF:", key: "funcsFound" },
  { prefix: "FNH:", key: "funcsHit" },
] as const;

// lcov records for the fixture skill's temp agent-root appear as
// `../…/private/…/T/…`; only count files that live inside the repo tree.
const isExternal = (sourceFile: string): boolean =>
  sourceFile.startsWith("..") || sourceFile.includes("node_modules/");

const parseLcov = (lcov: string): Totals => {
  const totals: Totals = {
    linesFound: 0,
    linesHit: 0,
    funcsFound: 0,
    funcsHit: 0,
  };
  let skip = false;
  for (const line of lcov.split("\n")) {
    if (line.startsWith(SF_PREFIX)) {
      skip = isExternal(line.slice(SF_PREFIX.length));
      continue;
    }
    if (skip) continue;
    for (const { prefix, key } of METRICS) {
      if (line.startsWith(prefix)) {
        totals[key] += Number(line.slice(prefix.length));
      }
    }
  }
  return totals;
};

const pct = (hit: number, found: number): number =>
  found === 0 ? PERCENT : (PERCENT * hit) / found;

const report = (label: string, value: number, floor: number): boolean => {
  const ok = value >= floor;
  const mark = ok ? "✓" : "✗";
  console.log(
    `  ${mark} ${label.padEnd(LABEL_WIDTH)} ${
      value.toFixed(2)
    }%  (floor ${floor}%, target ${TARGET_PCT}%)`,
  );
  return ok;
};

const proc = Bun.spawn(
  [
    "bun",
    "test",
    "--coverage",
    "--coverage-reporter=text",
    "--coverage-reporter=lcov",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const testExit = await proc.exited;
if (testExit !== 0) {
  console.error(
    "\n✗ coverage gate: test run failed — fix failing tests first.",
  );
  process.exit(testExit);
}

if (!(await Bun.file(LCOV_PATH).exists())) {
  console.error(
    `\n✗ coverage gate: ${LCOV_PATH} not found (did coverage run?).`,
  );
  process.exit(1);
}

const totals = parseLcov(await Bun.file(LCOV_PATH).text());
const linesPct = pct(totals.linesHit, totals.linesFound);
const funcsPct = pct(totals.funcsHit, totals.funcsFound);

console.log("\nCoverage gate — project aggregate:");
const linesOk = report("lines", linesPct, MIN_LINES_PCT);
const funcsOk = report("functions", funcsPct, MIN_FUNCS_PCT);

if (linesOk && funcsOk) {
  console.log("\n✓ coverage gate passed.");
  process.exit(0);
}
console.error(
  "\n✗ coverage gate failed: coverage dropped below the floor. Add tests for the "
    + "code you changed, or run `bun test --coverage` to see per-file gaps.",
);
process.exit(1);
