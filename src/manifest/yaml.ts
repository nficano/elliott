import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { hashBytes } from "../core/digest";
import { ManifestValidationError } from "../core/errors";
import type { ParsedOverlay } from "./types";

const MAX_FILE_BYTES = 1_048_576;
const MAX_SCALAR_BYTES = 262_144;
const MAX_DEPTH = 24;
const MAX_ALIASES = 32;

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateBounds = (value: unknown, depth = 0): void => {
  if (depth > MAX_DEPTH) {
    throw new ManifestValidationError("maximum YAML nesting depth exceeded");
  }
  if (
    typeof value === "string" && Buffer.byteLength(value) > MAX_SCALAR_BYTES
  ) {
    throw new ManifestValidationError("maximum YAML scalar size exceeded");
  }
  if (Array.isArray(value)) {
    for (const item of value) validateBounds(item, depth + 1);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) validateBounds(item, depth + 1);
  }
};

export const parseSecurityOverlay = (raw: string): ParsedOverlay => {
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) {
    throw new ManifestValidationError("maximum manifest.yaml size exceeded");
  }
  const document = parseDocument(raw, {
    customTags: [],
    merge: false,
    prettyErrors: true,
    resolveKnownTags: false,
    strict: true,
    uniqueKeys: true,
  });
  const parseProblems = [...document.errors, ...document.warnings];
  if (parseProblems.length > 0) {
    throw new ManifestValidationError(
      parseProblems.map((problem) => problem.message).join("; "),
    );
  }
  const value: unknown = document.toJS({ maxAliasCount: MAX_ALIASES });
  if (!isRecord(value)) {
    throw new ManifestValidationError("manifest.yaml must contain a mapping");
  }
  validateBounds(value);
  return Object.freeze({ raw, digest: hashBytes(raw), value });
};

export const assertContainedPath = async (
  root: string,
  candidate: string,
): Promise<string> => {
  const resolvedRoot = await realpath(root);
  const requested = path.resolve(resolvedRoot, candidate);
  const info = await lstat(requested);
  const resolvedCandidate = info.isSymbolicLink()
    ? await realpath(requested)
    : requested;
  const relation = path.relative(resolvedRoot, resolvedCandidate);
  if (relation === ".." || relation.startsWith(`..${path.sep}`)) {
    throw new ManifestValidationError("component path escapes its root");
  }
  return resolvedCandidate;
};
