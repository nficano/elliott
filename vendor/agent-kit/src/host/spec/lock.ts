/**
 * Ref → lockfile resolution (AGENT-SPEC §1.4). A `uses: <skill>@<ref>` ref is
 * a git tag on the agent-kit repo, named by debaser (`git tag $(debaser <sha>)
 * <sha>`). Resolution happens at DEPLOY: each referenced skill's tree is
 * resolved at its tag and recorded in `agent-kit.lock`, so runtime never
 * touches the network and a deleted tag can't break a running agent.
 *
 * v1 honesty (AGENT-SPEC §5.3): skills ship in the installed agent-kit tree,
 * so the lock records provenance (ref → commit sha → skill tree hash) and the
 * loader WARNS when a locked skill's tree differs from the installed HEAD —
 * the "nudge refs into agreement" fallback, never a hard top-level pin.
 */

export interface GitResolver {
  /** `git rev-parse <rev>` — resolves tags, `<tag>:<path>` tree refs, HEAD. */
  revParse(rev: string): Promise<string>;
}

export interface UsesRef {
  /** Skill id, e.g. "youtube" (from `uses: youtube/channel-uploads@tag`). */
  readonly skill: string;
  /** The git tag (debaser release name). */
  readonly ref: string;
}

export interface LockEntry {
  readonly skill: string;
  readonly ref: string;
  /** Commit sha the tag points at. */
  readonly sha: string;
  /** Repo path whose tree is pinned (pack dir for pack members). */
  readonly path: string;
  /** Tree hash of `path` at that commit — the content pin. */
  readonly tree: string;
}

export interface Lockfile {
  readonly version: 1;
  readonly entries: readonly LockEntry[];
}

export const LOCKFILE_NAME = "agent-kit.lock";

export class RefResolutionError extends Error {}

const defaultTreePath = (skill: string): string => `src/skills/${skill}`;

/**
 * Resolve every unique (skill, ref) pair into a deterministic lockfile.
 * `treePathOf` maps a skill id to the repo path holding its source — pack
 * members share their pack dir (e.g. browser → src/skills/web).
 */
export async function resolveRefs(
  uses: readonly UsesRef[],
  git: GitResolver,
  treePathOf: (skill: string) => string = defaultTreePath,
): Promise<Lockfile> {
  const unique = new Map<string, UsesRef>();
  for (const u of uses) unique.set(`${u.skill}@${u.ref}`, u);
  const entries: LockEntry[] = [];
  for (const u of [...unique.values()].sort(byKey)) {
    const path = treePathOf(u.skill);
    const sha = await revParseOr(git, u.ref, () =>
      new RefResolutionError(
        `unknown ref "${u.ref}" for skill "${u.skill}" — not a git tag on this repo`,
      ));
    const tree = await revParseOr(git, `${u.ref}:${path}`, () =>
      new RefResolutionError(
        `skill "${u.skill}" does not exist at ref "${u.ref}" (${path})`,
      ));
    entries.push({ skill: u.skill, ref: u.ref, sha, path, tree });
  }
  return { version: 1, entries };
}

/**
 * Compare each locked skill tree against the installed HEAD tree. A mismatch
 * is a WARNING (§5.3): the running code is HEAD's, not the locked ref's.
 */
export async function verifyAgainstHead(
  lock: Lockfile,
  git: GitResolver,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const e of lock.entries) {
    let headTree: string;
    try {
      headTree = await git.revParse(`HEAD:${e.path}`);
    } catch {
      warnings.push(
        `skill "${e.skill}" locked at ${e.ref} is missing from the installed tree`,
      );
      continue;
    }
    if (headTree !== e.tree) {
      warnings.push(
        `skill "${e.skill}" pinned at ${e.ref} (${
          e.tree.slice(0, 12)
        }) differs from the installed tree — running code is the installed version; ` +
          `re-tag or update the ref to match`,
      );
    }
  }
  return warnings;
}

export function serializeLockfile(lock: Lockfile): string {
  const entries = [...lock.entries].sort(byKey);
  return `${JSON.stringify({ version: lock.version, entries }, null, 2)}\n`;
}

export function parseLockfile(text: string): Lockfile {
  const raw = JSON.parse(text) as {
    version?: unknown;
    entries?: unknown;
  };
  if (raw.version !== 1 || !Array.isArray(raw.entries)) {
    throw new RefResolutionError(`unrecognized ${LOCKFILE_NAME} format`);
  }
  for (const e of raw.entries as Record<string, unknown>[]) {
    for (const field of ["skill", "ref", "sha", "path", "tree"]) {
      if (typeof e[field] !== "string") {
        throw new RefResolutionError(
          `${LOCKFILE_NAME} entry missing "${field}"`,
        );
      }
    }
  }
  return { version: 1, entries: raw.entries as LockEntry[] };
}

/** Default resolver — shells out to git in `repoRoot`. */
export function gitResolver(repoRoot: string): GitResolver {
  return {
    async revParse(rev: string): Promise<string> {
      const proc = Bun.spawn(
        ["git", "-C", repoRoot, "rev-parse", "--verify", "--quiet", rev],
        { stdout: "pipe", stderr: "pipe" },
      );
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code !== 0) throw new RefResolutionError(`git rev-parse ${rev} failed`);
      return out.trim();
    },
  };
}

async function revParseOr(
  git: GitResolver,
  rev: string,
  err: () => RefResolutionError,
): Promise<string> {
  try {
    return await git.revParse(rev);
  } catch {
    throw err();
  }
}

function byKey(a: UsesRef | LockEntry, b: UsesRef | LockEntry): number {
  const ka = `${a.skill}@${a.ref}`;
  const kb = `${b.skill}@${b.ref}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
