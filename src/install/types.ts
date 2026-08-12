// Installable skills: types for the nficano/skills registry.
// See docs/explanation/skills-registry.md. Installation is a build/CLI-time step producing
// a committed, authoritative lockfile; boot-time refresh runs only where state
// is writable. The lock (exact version + content digest) is the pin.

// One parsed `install.skills` entry: a bare name (unpinned → latest at resolve
// time) or name@version (pinned → exactly that tag).
export interface InstallEntry {
  readonly name: string;
  readonly version?: string;
  // Required entries (default: gateways) flip health.ready false when they
  // fail to install. Derived by the loader, not from config, in v1.
  readonly required: boolean;
}

export interface InstallSettings {
  readonly registry: string;
  // Boot-time latest re-resolution. Only honored where state is writable;
  // production leaves this false and trusts the baked lock.
  readonly refresh: boolean;
  readonly skills: readonly InstallEntry[];
}

// One resolved skill in the committed lockfile. The digest makes the lock a
// real pin: fetched bytes are verified against it on every fetch.
export interface LockEntry {
  readonly version: string;
  readonly tag: string;
  readonly digest: string;
  readonly pinned: boolean;
}

export interface LockFile {
  readonly version: 1;
  readonly registry: string;
  readonly skills: Readonly<Record<string, LockEntry>>;
}

export type InstallState = "ok" | "cached-fallback" | "failed";

export type InstallMode = "frozen" | "refresh";

// One line of the /healthz install section and the human-facing report.
export interface InstallOutcome {
  readonly skill: string;
  readonly requested: string;
  readonly resolved?: string;
  readonly state: InstallState;
  readonly required: boolean;
  readonly directory?: string;
  readonly error?: string;
}

export interface InstallResult {
  // Cache directories to hand to loadPackageAt, one per successfully-materialized
  // skill (ok or cached-fallback).
  readonly directories: readonly string[];
  readonly outcomes: readonly InstallOutcome[];
  // The lock as it should be persisted after a refresh run. Equal to the input
  // lock on a frozen run.
  readonly lock: LockFile;
}

// A ref returned by the registry: a skill tag and the version it encodes.
export interface RegistryTag {
  readonly name: string;
  readonly version: string;
  readonly tag: string;
}

// Injected so tests drive the installer against a local fixture registry with
// no network. The GitHub implementation lives in registry.ts.
export interface RegistryClient {
  listTags(): Promise<readonly RegistryTag[]>;
  // Raw .tar.gz bytes for one tag (whole-repo tarball at that tag's commit).
  fetchTarball(tag: string): Promise<Uint8Array>;
}

export interface InstallOptions {
  readonly settings: InstallSettings;
  readonly cacheDir: string;
  readonly lock: LockFile;
  readonly registry: RegistryClient;
  readonly mode: InstallMode;
}

// One entry of GitHub's git/matching-refs/tags response.
export interface GitHubRef {
  readonly ref?: unknown;
}

// Everything one entry's resolution needs, bundled so the resolver takes a
// single argument.
export interface ResolveInput {
  readonly entry: InstallEntry;
  readonly options: InstallOptions;
  readonly tags: readonly RegistryTag[] | undefined;
  // A refresh whose tag listing failed serves cache without verifying latest —
  // reported as cached-fallback, not ok.
  readonly listingFailed: boolean;
}

export interface FetchContext {
  readonly requested: string;
  readonly version: string;
  readonly tag: string;
  readonly cacheTarget: string;
  readonly expectedDigest: string | undefined;
  readonly locked: LockEntry | undefined;
}

export interface ResolveOutcome {
  readonly outcome: InstallOutcome;
  readonly lock?: LockEntry;
}

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}
