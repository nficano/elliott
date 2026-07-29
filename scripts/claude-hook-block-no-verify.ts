#!/usr/bin/env bun
/**
 * Claude Code PreToolUse hook (Bash): blocks git commands that bypass the
 * pre-push quality gate — `--no-verify` and `core.hooksPath` overrides. The
 * gate exists precisely for the moments it is inconvenient; if it fails,
 * report the failure instead of routing around it.
 *
 * Quoted strings are stripped before matching so a commit message that
 * *mentions* --no-verify does not trip the hook.
 *
 * Exit 2 blocks the tool call and shows stderr to the model; exit 0 allows.
 */

const BLOCK_EXIT_CODE = 2;

const SINGLE_QUOTED = /'[^']*'/g;
const DOUBLE_QUOTED = /"(?:[^"\\]|\\.)*"/g;
const NO_VERIFY = /(^|[\s;&|])--no-verify(?=$|[\s;&|])/;
const HOOKS_PATH_OVERRIDE = /core\.hooksPath/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const commandOf = (payload: unknown): string => {
  if (!isRecord(payload) || !isRecord(payload.tool_input)) return "";
  const command = payload.tool_input.command;
  return typeof command === "string" ? command : "";
};

const payload: unknown = JSON.parse(await Bun.stdin.text());
const bare = commandOf(payload)
  .replaceAll(SINGLE_QUOTED, "")
  .replaceAll(DOUBLE_QUOTED, "");

const bypasses = /\bgit\b/.test(bare)
  && (NO_VERIFY.test(bare) || HOOKS_PATH_OVERRIDE.test(bare));
if (!bypasses) process.exit(0);

console.error(
  "⛔ This command bypasses the pre-push quality gate (--no-verify / "
    + "core.hooksPath override). Run the gates and fix what fails. If a gate "
    + "is genuinely broken, report it to the operator — emergency bypasses "
    + "are the operator's call, made by hand.",
);
process.exit(BLOCK_EXIT_CODE);
