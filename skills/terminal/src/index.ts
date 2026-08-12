import { mkdir } from "node:fs/promises";
import { isJsonRecord } from "../../../src/providers/http";
import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  requiredString,
} from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  TerminalSettings,
  ToolDefinition,
} from "../../../src/runtime/types";

const COMMAND_TIMEOUT_MILLISECONDS = 60_000;
const MINIMAL_PATH = "/usr/local/bin:/usr/bin:/bin";

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const settings = context.settings.terminal;
  if (settings === undefined) return {};
  await mkdir(settings.root, { recursive: true });
  return { tools: [runTool(settings)] };
};

const runTool = (settings: TerminalSettings): ToolDefinition => ({
  name: "terminal_run",
  description: "Run an allowlisted command in the agent workspace (no "
    + `shell; argv only). Allowed commands: ${
      settings.allowedCommands.join(", ")
    }. Returns stdout, stderr, and the exit code.`,
  inputSchema: objectSchema({
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
  }, ["command"]),
  execute: async (input) => {
    const command = requiredString(input, "command");
    if (!settings.allowedCommands.includes(command)) {
      throw new Error(`Command ${command} is not on the terminal allowlist`);
    }
    return JSON.stringify(await run(settings, command, decodeArgs(input)));
  },
});

const decodeArgs = (input: unknown): readonly string[] => {
  if (!isJsonRecord(input) || !Array.isArray(input["args"])) return [];
  return input["args"].filter((item): item is string =>
    typeof item === "string"
  );
};

const run = async (
  settings: TerminalSettings,
  command: string,
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>>> => {
  const child = Bun.spawn([command, ...args], {
    cwd: settings.root,
    env: { PATH: MINIMAL_PATH },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const deadline = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MILLISECONDS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      exitCode,
      stdout: stdout.slice(0, MAX_TOOL_OUTPUT_CHARACTERS),
      stderr: stderr.slice(0, MAX_TOOL_OUTPUT_CHARACTERS),
    };
  } finally {
    clearTimeout(deadline);
  }
};
