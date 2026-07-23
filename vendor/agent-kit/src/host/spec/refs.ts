/**
 * `uses:` reference grammar (AGENT-SPEC §1.3):
 *
 *   <skill>@<ref>              youtube@red-roster
 *   <skill>/<op>@<ref>         youtube/channel-uploads@red-roster
 *   <skill>/<op>               github/draft-pr        (ref optional in dev)
 *   ./<path>                   ./skills/pakman-latest-episode   (local skill)
 *
 * A registry ref names a skill (and optionally one operation of it) at a
 * debaser-named git tag. A local ref names a consumer-repo skill by path; its
 * id is the basename and it rides the consumer's own commit (no ref).
 */

export interface RegistryUses {
  readonly kind: "registry";
  readonly skill: string;
  readonly op?: string;
  readonly ref?: string;
}

export interface LocalUses {
  readonly kind: "local";
  readonly path: string;
  /** Registrable id — the basename of the path. */
  readonly id: string;
}

export type ParsedUses = RegistryUses | LocalUses;

export class UsesParseError extends Error {}

const ID = /^[a-z][a-z0-9-]*$/;

export function parseUses(input: string): ParsedUses {
  const raw = input.trim();
  if (raw.length === 0) throw new UsesParseError("empty uses: reference");

  if (raw.startsWith("./") || raw.startsWith("../")) {
    if (raw.includes("@")) {
      throw new UsesParseError(
        `local uses: takes no ref (rides the consumer commit): ${raw}`,
      );
    }
    const id = raw.split("/").filter(Boolean).at(-1);
    if (!id || !ID.test(id)) {
      throw new UsesParseError(`local uses: has no valid skill id: ${raw}`);
    }
    return { kind: "local", path: raw, id };
  }

  const at = raw.lastIndexOf("@");
  const head = at === -1 ? raw : raw.slice(0, at);
  const ref = at === -1 ? undefined : raw.slice(at + 1);
  if (ref !== undefined && ref.length === 0) {
    throw new UsesParseError(`empty ref in uses: ${raw}`);
  }

  const segments = head.split("/");
  if (segments.length > 2) {
    throw new UsesParseError(
      `uses: is <skill>[/<op>][@<ref>], got: ${raw}`,
    );
  }
  const [skill, op] = segments;
  if (!skill || !ID.test(skill)) {
    throw new UsesParseError(`invalid skill id in uses: ${raw}`);
  }
  if (op !== undefined && !ID.test(op)) {
    throw new UsesParseError(`invalid op in uses: ${raw}`);
  }
  return op === undefined
    ? (ref === undefined ? { kind: "registry", skill } : {
      kind: "registry",
      skill,
      ref,
    })
    : (ref === undefined ? { kind: "registry", skill, op } : {
      kind: "registry",
      skill,
      op,
      ref,
    });
}

/**
 * Candidate tool names for a `<skill>/<op>` step, in resolution order:
 * the fully-namespaced `<skill>_<op>` first (youtube/channel-uploads →
 * youtube_channel_uploads), then the bare op (github/draft-pr → draft_pr,
 * matching packs whose tool names don't repeat the skill namespace).
 */
export function toolCandidates(skill: string, op: string): string[] {
  const snake = (s: string): string => s.replaceAll("-", "_");
  return [`${snake(skill)}_${snake(op)}`, snake(op)];
}
