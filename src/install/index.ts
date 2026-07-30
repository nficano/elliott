// Public surface of the installable-skills subsystem. See docs/explanation/skills-registry.md.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { isJsonRecord } from "../providers/http";
import { parseInstallSettings } from "./entry";
import { install } from "./installer";
import { readLock, writeLock } from "./lock";
import { makeGitHubRegistry, parseRegistry } from "./registry";
import type {
  InstallMode,
  InstallResult,
  InstallSettings,
  RegistryClient,
} from "./types";

export { digestDirectory } from "./digest";
export { parseEntry, parseInstallSettings } from "./entry";
export { assertNoFatalOutcomes, install } from "./installer";
export { readLock, serializeLock, writeLock } from "./lock";
export { makeGitHubRegistry, parseRegistry } from "./registry";
export type { InstallOptions } from "./types";
export type {
  InstallEntry,
  InstallMode,
  InstallOutcome,
  InstallResult,
  InstallSettings,
  InstallState,
  LockEntry,
  LockFile,
  RegistryClient,
  RegistryTag,
} from "./types";
export { InstallError } from "./types";
export { compareVersions, latestVersion, parseTag } from "./version";

// Read just the `install:` block out of an agent repo's config, without the
// full runtime settings load (no secret resolution needed — install has none).
// Used by the CLI (`elliott skills …`) at build/lock time.
export const loadInstallSettings = async (
  agentRoot: string,
): Promise<InstallSettings | undefined> => {
  let raw: string;
  try {
    raw = await readFile(
      path.join(agentRoot, "config", "elliott.yaml"),
      "utf8",
    );
  } catch {
    return undefined;
  }
  const parsed: unknown = parse(raw);
  const block = isJsonRecord(parsed) ? parsed["install"] : undefined;
  return parseInstallSettings(block);
};

export const skillsCacheDir = (agentRoot: string): string =>
  path.join(agentRoot, ".elliott", "skills");

export const lockPath = (agentRoot: string): string =>
  path.join(agentRoot, "skills.lock.json");

// Top-level entry used by both the runtime boot and the CLI. Reads the
// committed lock, resolves + materializes each skill, and (only in refresh
// mode) persists the updated lock. Never throws for environmental failure —
// callers inspect result.outcomes and decide.
export const runInstall = async (options: {
  readonly agentRoot: string;
  readonly settings: InstallSettings;
  readonly mode: InstallMode;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
  // Test seam: inject a fixture registry instead of GitHub.
  readonly registry?: RegistryClient;
}): Promise<InstallResult> => {
  const cacheDir = skillsCacheDir(options.agentRoot);
  const lockFile = lockPath(options.agentRoot);
  const lock = await readLock(lockFile, options.settings.registry);
  const registry = options.registry ?? makeRegistry(options);
  const result = await install({
    settings: options.settings,
    cacheDir,
    lock,
    registry,
    mode: options.mode,
  });
  if (options.mode === "refresh") {
    await writeLock(lockFile, result.lock);
  }
  return result;
};

const makeRegistry = (options: {
  readonly settings: InstallSettings;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}): RegistryClient => {
  const { owner, repo } = parseRegistry(options.settings.registry);
  return makeGitHubRegistry(owner, repo, {
    ...(options.token !== undefined && { token: options.token }),
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
};
