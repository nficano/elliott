// Read/write of the committed, authoritative skills.lock.json. No timestamps
// in the artifact — they churned whole-file diffs and hid real version changes.

import { readFile, rename, writeFile } from "node:fs/promises";
import { isJsonRecord } from "../providers/http";
import type { LockEntry, LockFile } from "./types";
import { InstallError } from "./types";

export const emptyLock = (registry: string): LockFile => ({
  version: 1,
  registry,
  skills: {},
});

const decodeEntry = (value: unknown): LockEntry | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const version = value["version"];
  const tag = value["tag"];
  const digest = value["digest"];
  if (
    typeof version !== "string" || typeof tag !== "string"
    || typeof digest !== "string"
  ) return undefined;
  return { version, tag, digest, pinned: value["pinned"] === true };
};

export const readLock = async (
  filePath: string,
  registry: string,
): Promise<LockFile> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return emptyLock(registry);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallError(`${filePath} is not valid JSON`);
  }
  if (!isJsonRecord(parsed)) throw new InstallError(`${filePath} is malformed`);
  const skillsValue = parsed["skills"];
  const skills: Record<string, LockEntry> = {};
  if (isJsonRecord(skillsValue)) {
    for (const [name, value] of Object.entries(skillsValue)) {
      const entry = decodeEntry(value);
      if (entry !== undefined) skills[name] = entry;
    }
  }
  // A registry change does not silently invalidate existing digests (that was a
  // downgrade lever); the recorded registry travels with the lock and a change
  // is surfaced to the operator, not auto-applied.
  const lockedRegistry = typeof parsed["registry"] === "string"
    ? parsed["registry"]
    : registry;
  return { version: 1, registry: lockedRegistry, skills };
};

// Serialize with stable key ordering so committed diffs are minimal.
export const serializeLock = (lock: LockFile): string => {
  const names = Object.keys(lock.skills).sort((left, right) =>
    left.localeCompare(right)
  );
  const skills: Record<string, LockEntry> = {};
  for (const name of names) {
    const entry = lock.skills[name];
    if (entry !== undefined) skills[name] = entry;
  }
  return `${
    JSON.stringify({ version: 1, registry: lock.registry, skills }, null, 2)
  }\n`;
};

export const writeLock = async (
  filePath: string,
  lock: LockFile,
): Promise<void> => {
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, serializeLock(lock), "utf8");
  await rename(temporary, filePath);
};
