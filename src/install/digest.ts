// Content digest of an extracted skill directory: sha256 over every file's
// relative path AND bytes, sorted. Hashing the path (not just contents) means
// an undeclared extra file or a rename changes the digest — the same recipe as
// scripts/check-evolution-image-lock.py, deliberately stricter than the
// declared-files-only snapshot digest.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const collectFiles = async (
  root: string,
  relative: string,
): Promise<readonly string[]> => {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) return collectFiles(root, child);
      if (entry.isFile()) return [child];
      // Symlinks and other node types never legitimately appear in a skill
      // directory; excluding them keeps the digest defined over regular files.
      return [];
    }),
  );
  return nested.flat();
};

export const digestDirectory = async (directory: string): Promise<string> => {
  const files = [...await collectFiles(directory, "")].sort((left, right) =>
    left.localeCompare(right)
  );
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of files) {
    hasher.update(file);
    hasher.update("\0");
    hasher.update(await readFile(path.join(directory, file)));
    hasher.update("\0");
  }
  return `sha256-${hasher.digest("hex")}`;
};
