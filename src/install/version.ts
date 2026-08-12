// Semver handling for registry tags: strictly three-integer versions only.
// "Latest" is semver-max, not chronologically newest, and prerelease/build
// suffixes are excluded from latest-selection.

import type { RegistryTag } from "./types";

const THREE_PART = /^(\d+)\.(\d+)\.(\d+)$/;

export const parseVersion = (
  value: string,
): readonly [number, number, number] | undefined => {
  const match = THREE_PART.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) return 0;
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
};

// Decode a `name/vX.Y.Z` ref into a RegistryTag, or undefined if it doesn't
// match the exact three-integer scheme (prerelease/build suffixes rejected).
export const parseTag = (ref: string): RegistryTag | undefined => {
  const slash = ref.lastIndexOf("/v");
  if (slash === -1) return undefined;
  const name = ref.slice(0, slash);
  const version = ref.slice(slash + 2);
  if (name.length === 0 || parseVersion(version) === undefined) {
    return undefined;
  }
  return { name, version, tag: ref };
};

// The highest version among tags for one skill, or undefined if it has none.
export const latestVersion = (
  tags: readonly RegistryTag[],
  name: string,
): string | undefined => {
  const versions = tags
    .filter((tag) => tag.name === name)
    .map((tag) => tag.version);
  if (versions.length === 0) return undefined;
  let max = versions[0] as string;
  for (const current of versions) {
    if (compareVersions(current, max) > 0) max = current;
  }
  return max;
};
