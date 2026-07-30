// The GitHub-backed RegistryClient. Two verified facts drive this code:
//   * git/matching-refs/tags/ returns EVERY matching ref in a single response
//     with no Link pagination — consume the full array, bound its size.
//   * codeload tar.gz for a slashed tag names its root <repo>-<tag-dashed>
//     and does NOT reliably strip the leading v; the root is read from the
//     archive at extract time, never computed here.

import type { GitHubRef, RegistryClient, RegistryTag } from "./types";
import { InstallError } from "./types";
import { parseTag } from "./version";

// A registry with tens of thousands of refs is pathological; refuse rather than
// buffer an unbounded blob.
const MAX_REFS = 20_000;
const REF_PREFIX = /^refs\/tags\//;

const githubHeaders = (token: string | undefined): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "user-agent": "elliott-skills-installer",
  ...(token !== undefined && { authorization: `Bearer ${token}` }),
});

// The matching-refs endpoint returns every ref in one array; decode the ones
// that parse as <name>/vX.Y.Z tags and drop the rest.
const decodeRefs = (body: unknown): readonly RegistryTag[] => {
  if (!Array.isArray(body)) {
    throw new InstallError("registry tag listing was not an array");
  }
  if (body.length > MAX_REFS) {
    throw new InstallError(`registry returned too many refs (${body.length})`);
  }
  const tags: RegistryTag[] = [];
  for (const item of body as readonly GitHubRef[]) {
    const ref = item.ref;
    if (typeof ref !== "string") continue;
    const parsed = parseTag(ref.replace(REF_PREFIX, ""));
    if (parsed !== undefined) tags.push(parsed);
  }
  return tags;
};

export const makeGitHubRegistry = (
  owner: string,
  repo: string,
  options: {
    readonly token?: string;
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): RegistryClient => {
  const doFetch = options.fetch ?? globalThis.fetch;
  return {
    listTags: async (): Promise<readonly RegistryTag[]> => {
      const url =
        `https://api.github.com/repos/${owner}/${repo}/git/matching-refs/tags/`;
      const response = await doFetch(url, {
        headers: githubHeaders(options.token),
      });
      if (!response.ok) {
        throw new InstallError(
          `registry tag listing failed: ${response.status}`,
        );
      }
      return decodeRefs(await response.json());
    },
    fetchTarball: async (tag: string): Promise<Uint8Array> => {
      const url =
        `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/tags/${tag}`;
      const response = await doFetch(url, {
        headers: { "user-agent": "elliott-skills-installer" },
      });
      if (!response.ok) {
        throw new InstallError(
          `tarball fetch for ${tag} failed: ${response.status}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
};

// "nficano/skills" → { owner, repo }.
export const parseRegistry = (
  registry: string,
): { readonly owner: string; readonly repo: string; } => {
  const slash = registry.indexOf("/");
  if (slash <= 0 || slash === registry.length - 1) {
    throw new InstallError(`invalid registry "${registry}" (want owner/repo)`);
  }
  return { owner: registry.slice(0, slash), repo: registry.slice(slash + 1) };
};
