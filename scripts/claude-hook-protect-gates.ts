#!/usr/bin/env bun
/**
 * Claude Code PreToolUse hook (Edit|Write|MultiEdit): refuses agent edits to
 * quality-gate files. An agent facing a failing gate should fix the code, not
 * weaken the gate — lowering a coverage floor or relaxing a lint rule is an
 * operator decision. Registered in .claude/settings.json; the project root
 * arrives as argv[2] ($CLAUDE_PROJECT_DIR).
 *
 * Exit 2 blocks the tool call and shows stderr to the model; exit 0 allows.
 */

import path from "node:path";

const BLOCK_EXIT_CODE = 2;

// Directories end with the separator; everything is compared lowercase
// because the filesystem is case-insensitive (a .ESLINTRC edit hits the same
// inode).
const PROTECTED_PATHS = [
  "eslint.config.js",
  `eslint-rules${path.sep}`,
  "dprint.json",
  "tsconfig.json",
  `.githooks${path.sep}`,
  `.github${path.sep}workflows${path.sep}`,
  `.claude${path.sep}`,
  `config${path.sep}footprint-budgets.json`,
  `scripts${path.sep}coverage-gate.ts`,
  `scripts${path.sep}ratchet-guard.ts`,
  `scripts${path.sep}check-unicode-safety.ts`,
  `scripts${path.sep}check-workflow-security.ts`,
  `scripts${path.sep}claude-hook-protect-gates.ts`,
  `scripts${path.sep}claude-hook-block-no-verify.ts`,
  `scripts${path.sep}setup-hooks.sh`,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const targetPath = (payload: unknown): string | undefined => {
  if (!isRecord(payload) || !isRecord(payload.tool_input)) return undefined;
  const filePath = payload.tool_input.file_path;
  return typeof filePath === "string" ? filePath : undefined;
};

const protectedMatch = (
  root: string,
  filePath: string,
): string | undefined => {
  const repoRelative = path.relative(root, path.resolve(root, filePath))
    .toLowerCase();
  if (repoRelative.startsWith("..")) return undefined;
  return PROTECTED_PATHS.find((entry) =>
    entry.endsWith(path.sep)
      ? repoRelative.startsWith(entry)
      : repoRelative === entry
  );
};

const payload: unknown = JSON.parse(await Bun.stdin.text());
const root = process.argv[2]
  ?? (isRecord(payload) && typeof payload.cwd === "string" ? payload.cwd : "");
const filePath = targetPath(payload);
if (root === "" || filePath === undefined) process.exit(0);

const match = protectedMatch(root, filePath);
if (match === undefined) process.exit(0);

console.error(
  `⛔ ${match} is a protected quality-gate file (lint config, coverage `
    + "ratchet, git hooks, CI, or this guardrail layer). Fix the code, not "
    + "the gate. If the gate itself genuinely needs to change, stop and ask "
    + "the operator to make or approve that edit.",
);
process.exit(BLOCK_EXIT_CODE);
