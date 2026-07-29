import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  objectSchema,
  requiredString,
} from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { SshSettings, ToolDefinition } from "../../../src/runtime/types";

const COMMAND_TIMEOUT_MILLISECONDS = 60_000;
const CONNECT_TIMEOUT_SECONDS = 10;
const OWNER_ONLY = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const settings = context.settings.ssh;
  if (settings === undefined) return {};
  const keyPath = await materializeKey(context.stateDirectory, settings);
  return { tools: [execTool(settings, keyPath)] };
};

const materializeKey = async (
  stateDirectory: string,
  settings: SshSettings,
): Promise<string> => {
  const directory = path.join(stateDirectory, "ssh");
  await mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  const keyPath = path.join(directory, "identity");
  const material = settings.privateKey.endsWith("\n")
    ? settings.privateKey
    : `${settings.privateKey}\n`;
  await writeFile(keyPath, material, { mode: OWNER_ONLY });
  await chmod(keyPath, OWNER_ONLY);
  return keyPath;
};

const execTool = (settings: SshSettings, keyPath: string): ToolDefinition => ({
  name: "ssh_exec",
  description: "Run a command on an allowlisted SSH host with the scoped "
    + `runtime key. Allowed hosts: ${settings.hosts.join(", ")}. Returns `
    + "stdout, stderr, and the exit code. Explain consequential commands "
    + "before running them.",
  inputSchema: objectSchema({
    host: { type: "string" },
    command: { type: "string", minLength: 1 },
  }, ["host", "command"]),
  execute: async (input) => {
    const host = requiredString(input, "host");
    if (!settings.hosts.includes(host)) {
      throw new Error(`Host ${host} is not on the SSH allowlist`);
    }
    const command = requiredString(input, "command");
    return JSON.stringify(await run(settings, { host, command, keyPath }));
  },
});

const run = async (
  settings: SshSettings,
  request: {
    readonly host: string;
    readonly command: string;
    readonly keyPath: string;
  },
): Promise<Readonly<Record<string, unknown>>> => {
  // Allowlist entries may pin their own account as "user@host" (hosts differ in
  // which login they accept, e.g. nficano@spruce vs root@pve); a bare host falls
  // back to the shared settings.user.
  const destination = request.host.includes("@")
    ? request.host
    : `${settings.user}@${request.host}`;
  const child = Bun.spawn([
    "ssh",
    "-i",
    request.keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
    destination,
    request.command,
  ], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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
