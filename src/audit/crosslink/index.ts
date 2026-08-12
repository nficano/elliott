import { hashValue } from "../../core/digest";
import type { Digest } from "../../core/types";

const hashPair = (left: Digest, right: Digest): Digest =>
  hashValue([left, right]);

export const merkleRoot = (heads: readonly Digest[]): Digest => {
  if (heads.length === 0) return hashValue([]);
  let level = [...heads];
  while (level.length > 1) {
    const next: Digest[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      if (left === undefined) continue;
      next.push(hashPair(left, level[index + 1] ?? left));
    }
    level = next;
  }
  const root = level[0];
  return root ?? hashValue([]);
};
