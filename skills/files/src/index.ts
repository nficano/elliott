import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
import type { FilesSettings, ToolDefinition } from "../../../src/runtime/types";
import { containedForRead, containedForWrite } from "./contain";

const MAX_LIST_ENTRIES = 500;

export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const settings = context.settings.files;
  if (settings === undefined) return {};
  await mkdir(settings.root, { recursive: true });
  return {
    tools: [readTool(settings), writeTool(settings), listTool(settings)],
  };
};

const readTool = (settings: FilesSettings): ToolDefinition => ({
  name: "file_read",
  description: "Read a UTF-8 text file from the agent workspace. Paths are "
    + "relative to the workspace root; escapes are rejected.",
  inputSchema: objectSchema({ path: { type: "string" } }, ["path"]),
  execute: async (input) => {
    const target = await containedForRead(
      settings.root,
      requiredString(input, "path"),
    );
    const text = await readFile(target, "utf8");
    return JSON.stringify({
      path: requiredString(input, "path"),
      truncated: text.length > MAX_TOOL_OUTPUT_CHARACTERS,
      text: text.slice(0, MAX_TOOL_OUTPUT_CHARACTERS),
    });
  },
});

const writeTool = (settings: FilesSettings): ToolDefinition => ({
  name: "file_write",
  description: "Write a UTF-8 text file inside the agent workspace, creating "
    + "parent directories. Overwrites an existing file at that path.",
  inputSchema: objectSchema({
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  execute: async (input) => {
    const target = await containedForWrite(
      settings.root,
      requiredString(input, "path"),
    );
    const content = requiredString(input, "content");
    await writeFile(target, content, "utf8");
    return JSON.stringify({
      ok: true,
      path: requiredString(input, "path"),
      bytes: Buffer.byteLength(content),
    });
  },
});

const listTool = (settings: FilesSettings): ToolDefinition => ({
  name: "file_list",
  description: "List entries in a workspace directory (name and kind). "
    + "Omit `path` for the workspace root.",
  inputSchema: objectSchema({ path: { type: "string" } }, []),
  execute: async (input) => {
    const relative = isJsonRecord(input) && typeof input["path"] === "string"
      ? input["path"]
      : ".";
    const target = await containedForRead(settings.root, relative);
    const entries = await readdir(target, { withFileTypes: true });
    return JSON.stringify(
      entries.slice(0, MAX_LIST_ENTRIES).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      })),
    );
  },
});
