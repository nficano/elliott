// Fetch one skill's bytes from a registry tarball and materialize a validated
// cache directory. Extraction uses the system `tar` because GitHub/git-archive
// tarballs are pax format (leading pax_global_header, per-file extended headers
// for long paths) that a bespoke ustar reader mis-parses. We extract into a
// temp dir, read the archive's real top-level name, whitelist only the one
// skill subtree, validate it, and atomically rename into the cache.

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { isJsonRecord } from "../providers/http";
import { InstallError } from "./types";

// ~200 MB. One codeload tarball is the whole repo at a tag; this bounds a
// malicious/oversized archive without a compression-bomb ratio check.
const MAX_TARBALL_BYTES = 200_000_000;
const DOCUMENTS: ReadonlySet<string> = new Set([
  "SKILL.md",
  "TOOL.md",
  "GATEWAY.md",
  "MCP.md",
  "EXTENSION.md",
  "SCHEDULER.md",
  "EVALUATOR.md",
]);

// Extract a .tar.gz into a fresh temp dir via system tar and return the path to
// the archive's single top-level directory (read, never computed).
const extractTarball = async (
  bytes: Uint8Array,
): Promise<
  { readonly root: string; readonly cleanup: () => Promise<void>; }
> => {
  if (bytes.byteLength > MAX_TARBALL_BYTES) {
    throw new InstallError(
      `tarball exceeds ${MAX_TARBALL_BYTES} byte cap`,
    );
  }
  const workspace = await mkdtemp(path.join(tmpdir(), "elliott-skill-"));
  const cleanup = () => rm(workspace, { recursive: true, force: true });
  const archive = path.join(workspace, "archive.tar.gz");
  const out = path.join(workspace, "out");
  await writeFile(archive, bytes);
  await mkdir(out);
  const proc = Bun.spawn([
    "tar",
    "-xzf",
    archive,
    "-C",
    out,
  ], { stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    await cleanup();
    throw new InstallError(`tar extraction failed: ${stderr.trim()}`);
  }
  const entries = (await readdir(out, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory());
  const first = entries[0];
  if (entries.length !== 1 || first === undefined) {
    await cleanup();
    throw new InstallError("tarball has no single top-level directory");
  }
  return { root: path.join(out, first.name), cleanup };
};

// Reject anything that would break module resolution or the loader once the
// directory is cached: a nested package.json shadows elliott's package
// self-reference, and a cross-package `../<sibling>` import escapes the cache
// layout. Both are also rejected by registry CI; this is defense in depth.
const validateSkillTree = async (
  directory: string,
  name: string,
  version: string,
): Promise<void> => {
  const manifestRaw = await readFile(
    path.join(directory, "manifest.yaml"),
    "utf8",
  ).catch(() => {
    throw new InstallError(`${name}: tarball has no manifest.yaml`);
  });
  const manifest: unknown = parse(manifestRaw);
  if (!isJsonRecord(manifest)) {
    throw new InstallError(`${name}: invalid manifest`);
  }
  if (manifest["apiVersion"] !== "elliott/v1") {
    throw new InstallError(`${name}: unsupported apiVersion`);
  }
  const metadata = manifest["metadata"];
  const spec = manifest["spec"];
  if (!isJsonRecord(metadata) || !isJsonRecord(spec)) {
    throw new InstallError(`${name}: invalid manifest metadata/spec`);
  }
  if (metadata["name"] !== name) {
    throw new InstallError(
      `${name}: manifest name "${String(metadata["name"])}" != directory`,
    );
  }
  if (metadata["version"] !== version) {
    throw new InstallError(
      `${name}: manifest version "${
        String(metadata["version"])
      }" != tag ${version}`,
    );
  }
  const document = spec["document"];
  if (typeof document !== "string" || !DOCUMENTS.has(document)) {
    throw new InstallError(`${name}: invalid spec.document`);
  }
  await assertNoForbiddenFiles(directory, directory);
};

const assertNoForbiddenFiles = async (
  root: string,
  directory: string,
): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new InstallError(
        `symlink not allowed: ${path.relative(root, full)}`,
      );
    }
    if (entry.isDirectory()) {
      await assertNoForbiddenFiles(root, full);
      continue;
    }
    if (entry.name === "package.json") {
      throw new InstallError(
        `nested package.json not allowed: ${path.relative(root, full)}`,
      );
    }
    if (entry.name.endsWith(".ts")) {
      const source = await readFile(full, "utf8");
      if (/from\s+["']\.\.\/\.\.\//.test(source)) {
        throw new InstallError(
          `cross-package import in ${path.relative(root, full)}`,
        );
      }
    }
  }
};

// Materialize <name>@<version> from a registry tarball into cacheDir. Returns
// the final directory and its content digest. Caller compares the digest to the
// lock. Extraction/validation happen in temp; only a validated tree lands in
// the cache, via atomic same-parent rename.
export const materializeSkill = async (options: {
  readonly tarball: Uint8Array;
  readonly name: string;
  readonly version: string;
  readonly cacheDir: string;
}): Promise<string> => {
  const { root, cleanup } = await extractTarball(options.tarball);
  try {
    const source = path.join(root, options.name);
    if (!(await pathExists(source))) {
      throw new InstallError(
        `${options.name}: tarball has no ${options.name}/ directory`,
      );
    }
    await validateSkillTree(source, options.name, options.version);
    const target = path.join(options.cacheDir, options.name, options.version);
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    // Rename must be same-filesystem; move the validated subtree next to the
    // final location first, then rename into place.
    const staged = `${target}.staging`;
    await rm(staged, { recursive: true, force: true });
    await cpDirectory(source, staged);
    await rename(staged, target);
    return target;
  } finally {
    await cleanup();
  }
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await readdir(target);
    return true;
  } catch {
    return false;
  }
};

const cpDirectory = async (from: string, to: string): Promise<void> => {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await cpDirectory(source, destination);
    } else if (entry.isFile()) {
      await writeFile(destination, await readFile(source));
    }
  }
};
