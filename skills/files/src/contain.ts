import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

const escape = (candidate: string): Error =>
  new Error(`Path ${candidate} escapes the workspace grant`);

const lexicallyContained = (root: string, candidate: string): string => {
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw escape(candidate);
  }
  return resolved;
};

const assertRealContainment = async (
  root: string,
  existing: string,
  candidate: string,
): Promise<void> => {
  const realRoot = await realpath(root);
  const real = await realpath(existing);
  const relative = path.relative(realRoot, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw escape(candidate);
  }
};

export const containedForRead = async (
  root: string,
  candidate: string,
): Promise<string> => {
  const resolved = lexicallyContained(root, candidate);
  await assertRealContainment(root, resolved, candidate);
  return resolved;
};

export const containedForWrite = async (
  root: string,
  candidate: string,
): Promise<string> => {
  const resolved = lexicallyContained(root, candidate);
  await mkdir(path.dirname(resolved), { recursive: true });
  await assertRealContainment(root, path.dirname(resolved), candidate);
  return resolved;
};
