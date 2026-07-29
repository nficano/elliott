#!/usr/bin/env bun
/**
 * Coverage-ratchet guard: the floors in scripts/coverage-gate.ts may only go
 * up. Compares MIN_LINES_PCT / MIN_FUNCS_PCT at HEAD against the base
 * revision and fails if either was lowered.
 *
 * Base revision: first CLI argument if given; otherwise
 * merge-base(HEAD, origin/main); when HEAD *is* that merge-base (a direct
 * push to main), the parent commit. Passes with a note when no base exists
 * (fresh clone without origin/main, root commit).
 */

const GATE_PATH = "scripts/coverage-gate.ts";
const SHORT_REF_LENGTH = 12;
const FLOORS = [
  { name: "MIN_LINES_PCT", pattern: /MIN_LINES_PCT = (\d+)/ },
  { name: "MIN_FUNCS_PCT", pattern: /MIN_FUNCS_PCT = (\d+)/ },
] as const;

const git = (args: readonly string[]): string | undefined => {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.success ? result.stdout.toString().trim() : undefined;
};

const resolveBaseRef = (): string | undefined => {
  const override = process.argv[2];
  if (override !== undefined && override.length > 0) return override;
  const head = git(["rev-parse", "HEAD"]);
  const mergeBase = git(["merge-base", "HEAD", "origin/main"]);
  if (head === undefined || mergeBase === undefined) return undefined;
  if (mergeBase !== head) return mergeBase;
  return git(["rev-parse", "--verify", "HEAD~1"]);
};

const floorsOf = (source: string): ReadonlyMap<string, number> => {
  const floors = new Map<string, number>();
  for (const { name, pattern } of FLOORS) {
    const match = pattern.exec(source);
    if (match?.[1] !== undefined) floors.set(name, Number(match[1]));
  }
  return floors;
};

const pass = (note: string): never => {
  console.log(`✓ ratchet guard: ${note}`);
  process.exit(0);
};

const baseRef = resolveBaseRef();
if (baseRef === undefined) {
  pass("no base revision available — skipping (nothing to compare).");
}
const baseSource = git(["show", `${baseRef}:${GATE_PATH}`]);
if (baseSource === undefined) {
  pass(`${GATE_PATH} does not exist at ${baseRef} — nothing to compare.`);
}

const baseFloors = floorsOf(baseSource);
const currentFloors = floorsOf(await Bun.file(GATE_PATH).text());
const regressions: string[] = [];
for (const [name, baseValue] of baseFloors) {
  const currentValue = currentFloors.get(name);
  if (currentValue === undefined) {
    regressions.push(`${name} was removed (was ${baseValue}%)`);
  } else if (currentValue < baseValue) {
    regressions.push(`${name} lowered ${baseValue}% → ${currentValue}%`);
  }
}

if (regressions.length === 0) {
  pass(
    `coverage floors hold at or above ${baseRef.slice(0, SHORT_REF_LENGTH)}.`,
  );
}
console.error("✗ ratchet guard: coverage floors only move up. Regressions:");
for (const regression of regressions) console.error(`  - ${regression}`);
console.error(
  "Add tests to restore coverage instead of lowering the floor. If a floor "
    + "genuinely must move, the operator makes that change, not the agent.",
);
process.exit(1);
