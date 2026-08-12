// Orchestration: resolve each install entry to a version, materialize a
// validated cache directory, verify it against the authoritative lock, and
// (in refresh mode) produce an updated lock. Two modes share one path:
//   * frozen  — build/CLI time. Versions come from the lock; fetched bytes MUST
//     match the locked digest; the lock is never rewritten.
//   * refresh — writable/dev. Unpinned entries re-resolve to latest; the lock
//     is rewritten. Production never refreshes.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { digestDirectory } from "./digest";
import { materializeSkill } from "./fetch";
import { emptyLock } from "./lock";
import type {
  FetchContext,
  InstallEntry,
  InstallOptions,
  InstallOutcome,
  InstallResult,
  LockEntry,
  LockFile,
  RegistryTag,
  ResolveInput,
  ResolveOutcome,
} from "./types";
import { InstallError } from "./types";
import { latestVersion } from "./version";

const dirExists = async (target: string): Promise<boolean> => {
  try {
    await readdir(target);
    return true;
  } catch {
    return false;
  }
};

// Decide which version an entry should resolve to, per mode.
const targetVersion = (
  input: ResolveInput,
  locked: LockEntry | undefined,
): string | undefined => {
  const { entry, options: { mode }, tags } = input;
  if (entry.version !== undefined) return entry.version;
  if (mode === "frozen") return locked?.version;
  // refresh, unpinned: latest from a live listing, else fall back to the lock.
  if (tags === undefined) return locked?.version;
  return latestVersion(tags, entry.name) ?? locked?.version;
};

// A cache directory whose digest matches the lock (or which has no lock digest
// to check yet) satisfies an entry without any network fetch.
const cacheHit = async (
  input: ResolveInput,
  context: FetchContext,
): Promise<ResolveOutcome | undefined> => {
  if (!(await dirExists(context.cacheTarget))) return undefined;
  const actual = await digestDirectory(context.cacheTarget);
  if (
    context.expectedDigest !== undefined && actual !== context.expectedDigest
  ) {
    return undefined; // discard and re-fetch
  }
  return {
    outcome: {
      skill: input.entry.name,
      requested: context.requested,
      resolved: context.version,
      state: input.listingFailed ? "cached-fallback" : "ok",
      required: input.entry.required,
      directory: context.cacheTarget,
    },
    lock: {
      version: context.version,
      tag: context.tag,
      digest: actual,
      pinned: input.entry.version !== undefined,
    },
  };
};

// Try to satisfy one entry. Never throws for environmental failure — a down
// registry degrades to cache; only nothing-usable yields `failed`.
const resolveOne = async (input: ResolveInput): Promise<ResolveOutcome> => {
  const { entry, options } = input;
  const requested = entry.version === undefined
    ? entry.name
    : `${entry.name}@${entry.version}`;
  const locked = options.lock.skills[entry.name];
  const version = targetVersion(input, locked);
  if (version === undefined) {
    return {
      outcome: {
        skill: entry.name,
        requested,
        state: "failed",
        required: entry.required,
        error: options.mode === "frozen"
          ? "no lock entry; run 'elliott skills lock'"
          : "no published tags and no lock fallback",
      },
    };
  }
  const context: FetchContext = {
    requested,
    version,
    tag: `${entry.name}/v${version}`,
    cacheTarget: path.join(options.cacheDir, entry.name, version),
    expectedDigest: locked?.version === version ? locked.digest : undefined,
    locked,
  };
  return (await cacheHit(input, context))
    ?? fetchAndVerify(entry, options, context);
};

const cachedFallback = async (
  entry: InstallEntry,
  context: FetchContext,
  error: string,
): Promise<ResolveOutcome> => {
  const lockedTarget = context.locked === undefined
    ? undefined
    : context.cacheTarget;
  if (
    context.locked !== undefined && lockedTarget !== undefined
    && await dirExists(lockedTarget)
    && await digestDirectory(lockedTarget) === context.locked.digest
  ) {
    return {
      outcome: {
        skill: entry.name,
        requested: context.requested,
        resolved: context.locked.version,
        state: "cached-fallback",
        required: entry.required,
        directory: lockedTarget,
      },
      lock: context.locked,
    };
  }
  return {
    outcome: {
      skill: entry.name,
      requested: context.requested,
      state: "failed",
      required: entry.required,
      error,
    },
  };
};

const fetchAndVerify = async (
  entry: InstallEntry,
  options: InstallOptions,
  context: FetchContext,
): Promise<ResolveOutcome> => {
  let directory: string;
  let digest: string;
  try {
    const tarball = await options.registry.fetchTarball(context.tag);
    directory = await materializeSkill({
      tarball,
      name: entry.name,
      version: context.version,
      cacheDir: options.cacheDir,
    });
    digest = await digestDirectory(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return cachedFallback(entry, context, message);
  }
  // A digest mismatch for the SAME version is a moved/re-pointed tag — refuse.
  if (
    context.expectedDigest !== undefined && digest !== context.expectedDigest
  ) {
    return cachedFallback(
      entry,
      context,
      `digest mismatch for ${context.tag} (tag moved?)`,
    );
  }
  return {
    outcome: {
      skill: entry.name,
      requested: context.requested,
      resolved: context.version,
      state: "ok",
      required: entry.required,
      directory,
    },
    lock: {
      version: context.version,
      tag: context.tag,
      digest,
      pinned: entry.version !== undefined,
    },
  };
};

export const install = async (
  options: InstallOptions,
): Promise<InstallResult> => {
  // Frozen never lists tags (versions come from the lock). Refresh lists once;
  // a listing failure degrades every entry to its cache rather than aborting.
  let tags: readonly RegistryTag[] | undefined;
  if (options.mode === "refresh") {
    try {
      tags = await options.registry.listTags();
    } catch {
      tags = undefined;
    }
  }
  const listingFailed = options.mode === "refresh" && tags === undefined;
  const outcomes: InstallOutcome[] = [];
  const directories: string[] = [];
  const nextSkills: Record<string, LockEntry> = {};
  for (const entry of options.settings.skills) {
    const { outcome, lock } = await resolveOne({
      entry,
      options,
      tags,
      listingFailed,
    });
    outcomes.push(outcome);
    if (outcome.directory !== undefined) directories.push(outcome.directory);
    if (lock !== undefined) nextSkills[entry.name] = lock;
  }
  // Refresh rewrites (and prunes) the lock; frozen leaves it untouched.
  const lock: LockFile = options.mode === "refresh"
    ? { version: 1, registry: options.settings.registry, skills: nextSkills }
    : options.lock;
  return { directories, outcomes, lock };
};

// Convenience for a fresh empty lock keyed on a registry.
export const initialLock = (registry: string): LockFile => emptyLock(registry);

export const assertNoFatalOutcomes = (
  outcomes: readonly InstallOutcome[],
): void => {
  const failedRequired = outcomes.filter((o) =>
    o.state === "failed" && o.required
  );
  if (failedRequired.length > 0) {
    const names = failedRequired.map((o) => o.skill).join(", ");
    throw new InstallError(`required skills failed to install: ${names}`);
  }
};
