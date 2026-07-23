import path from "node:path";
import { egressAllows } from "../placement/egress";
import type { BundledComponentDescriptor, WorkspacePathGrant } from "./types";

const contains = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(
    path.resolve(root),
    path.resolve(candidate),
  );
  return relativePath.length === 0
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const assertWorkspacePath = (
  candidate: string,
  grant: WorkspacePathGrant,
): string => {
  const roots = [grant.root, ...grant.additionalRoots];
  if (roots.every((root) => !contains(root, candidate))) {
    throw new Error("Path escapes the workspace grant");
  }
  return path.resolve(candidate);
};

const removeElement = (input: string, name: string): string => {
  let output = input;
  const open = `<${name}`;
  const close = `</${name}>`;
  for (;;) {
    const lower = output.toLowerCase();
    const start = lower.indexOf(open);
    if (start === -1) return output;
    const end = lower.indexOf(close, start);
    output = end === -1
      ? output.slice(0, start)
      : output.slice(0, start) + output.slice(end + close.length);
  }
};

export const stripActiveContent = (input: string): string => {
  const withoutScripts = removeElement(input, "script");
  return removeElement(withoutScripts, "style");
};

export const assertBrokeredDestination = (
  destination: string,
  policy: BundledComponentDescriptor["egress"],
): void => {
  if (!egressAllows(policy, destination)) {
    throw new Error(`Destination ${destination} is outside the egress grant`);
  }
};
