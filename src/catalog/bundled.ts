import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { ComponentKind } from "../core/types";
import { isJsonRecord } from "../providers/http";
import type { BundledExport, BundledPackage, FacilityRef } from "./types";

const DOCUMENTS: ReadonlySet<string> = new Set([
  "SKILL.md",
  "TOOL.md",
  "GATEWAY.md",
  "MCP.md",
  "EXTENSION.md",
  "SCHEDULER.md",
  "EVALUATOR.md",
]);

export const loadBundledPackages = (
  root: string,
): Promise<readonly BundledPackage[]> =>
  loadPackagesFrom(path.join(root, "skills"));

// Agent-level custom skills: same package format and loader as the bundled
// framework skills, but scoped to one agent under agents/<name>/skills/.
// An agent without a skills directory simply has none. See
// docs/agent-skills.md.
export const loadAgentSkillPackages = async (
  root: string,
  agent: string,
): Promise<readonly BundledPackage[]> => {
  const directory = path.join(root, "agents", agent, "skills");
  try {
    await access(directory);
  } catch {
    return [];
  }
  return loadPackagesFrom(directory);
};

const loadPackagesFrom = async (
  directory: string,
): Promise<readonly BundledPackage[]> => {
  const directories = await discoverPackageDirectories(directory);
  const packages = await Promise.all(directories.map(loadPackage));
  return packages.sort((left, right) => left.name.localeCompare(right.name));
};

const discoverPackageDirectories = async (
  directory: string,
): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<readonly string[]> => {
        const child = path.join(directory, entry.name);
        try {
          await access(path.join(child, "manifest.yaml"));
          return [child];
        } catch {
          return discoverPackageDirectories(child);
        }
      }),
  );
  return nested.flat();
};

// Load one package from an exact directory (e.g. an installed skill's
// <cache>/<name>/<version>). Unlike loadPackagesFrom this does NOT recurse, so
// it must never be pointed at a cache root holding many versions.
export const loadPackageAt = (directory: string): Promise<BundledPackage> =>
  loadPackage(directory);

const loadPackage = async (directory: string): Promise<BundledPackage> => {
  const raw = await readFile(path.join(directory, "manifest.yaml"), "utf8");
  const value: unknown = parse(raw);
  if (!isJsonRecord(value)) throw new Error(`${directory} has no manifest`);
  const metadata = value["metadata"];
  const spec = value["spec"];
  if (!isJsonRecord(metadata) || !isJsonRecord(spec)) {
    throw new Error(`${directory} has an invalid manifest`);
  }
  const name = metadata["name"];
  const profile = value["profile"];
  if (typeof name !== "string" || typeof profile !== "string") {
    throw new TypeError(`${directory} has invalid component metadata`);
  }
  const document = spec["document"];
  if (typeof document !== "string" || !DOCUMENTS.has(document)) {
    throw new Error(`${directory} has an invalid component document`);
  }
  const kind = decodeKind(value["kind"]);
  const protocols = spec["protocols"];
  await readFile(path.join(directory, document), "utf8");
  const exports = await decodeExports(directory, spec["exports"]);
  return {
    name,
    kind,
    profile,
    directory,
    document,
    protocols: Array.isArray(protocols)
      ? protocols.filter((item): item is string => typeof item === "string")
      : [],
    provides: decodeProvides(spec["provides"]),
    exports,
    ...(exports[0] !== undefined
      && { entrypoint: path.join(directory, exports[0].implementation) }),
    ...decodeTopologyBlock(spec),
  };
};

// The manifest's spec.topology block travels verbatim on the package so the
// telemetry map can auto-register the skill; absent or malformed blocks
// simply contribute no key.
const decodeTopologyBlock = (
  spec: Readonly<Record<string, unknown>>,
): { topology?: Readonly<Record<string, unknown>>; } => {
  const topology = spec["topology"];
  return isJsonRecord(topology) ? { topology } : {};
};

const decodeProvides = (value: unknown): readonly FacilityRef[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isJsonRecord(item)) return [];
    const facility = item["facility"];
    const version = item["version"];
    if (typeof facility !== "string" || !Number.isSafeInteger(version)) {
      return [];
    }
    return [{ facility, version: version as number }];
  });
};

const decodeExports = async (
  directory: string,
  value: unknown,
): Promise<readonly BundledExport[]> => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${directory} has an invalid exports list`);
  }
  const exports = value.map((item) => decodeExport(directory, item));
  await Promise.all(
    exports.map((item) =>
      readFile(path.join(directory, item.implementation), "utf8")
    ),
  );
  return exports;
};

const decodeExport = (directory: string, value: unknown): BundledExport => {
  if (!isJsonRecord(value)) {
    throw new Error(`${directory} has an invalid export entry`);
  }
  const ref = value["ref"];
  const implementation = value["implementation"];
  if (typeof ref !== "string" || typeof implementation !== "string") {
    throw new TypeError(
      `${directory} export entries need ref and implementation`,
    );
  }
  if (implementation.startsWith("/") || implementation.includes("..")) {
    throw new Error(`${directory} export escapes the package directory`);
  }
  return { ref, implementation };
};

const decodeKind = (value: unknown): ComponentKind => {
  const kinds: readonly ComponentKind[] = [
    "skill",
    "tool",
    "gateway",
    "mcp-endpoint",
    "extension",
    "scheduler",
    "evaluator",
  ];
  const result = kinds.find((kind) => kind === value);
  if (result === undefined) {
    throw new Error(`Unsupported bundled kind ${String(value)}`);
  }
  return result;
};
