import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ConfigError, formatSchemaError } from "../../core/errors.js";
import { envResolver, interpolate } from "./interpolate.js";
import { type AgentKitConfig, ConfigSchema } from "./schema.js";
import type { LoadedConfig, LoadOptions } from "./types.js";

/**
 * Layered load (§5): defaults.yaml → agent-kit.yaml → agent-kit.<env>.yaml →
 * `${…}` interpolation → Effect Schema decode. On success, snapshot the
 * PRE-interpolation merged source as last-known-good. On a failed reload,
 * callers recover from that snapshot rather than wedging the process.
 */

const LAYER_ORDER = (env: string, appName: string) => [
  "defaults.yaml",
  `${appName}.yaml`,
  `${appName}.${env}.yaml`,
];

async function readLayer(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(path)) return undefined;
  const text = await readFile(path, "utf8");
  const parsed = parseYaml(text) as unknown;
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError({
      message: `config layer ${path} must be a mapping`,
    });
  }
  return parsed as Record<string, unknown>;
}

/** Deep merge; later layers override, objects merged, scalars/arrays replaced. */
export function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prev = out[k];
    out[k] = isPlain(prev) && isPlain(v) ? deepMerge(prev, v) : v;
  }
  return out;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge the layers into one pre-interpolation source object. */
export async function mergeSource(
  dir: string,
  env: string,
  appName = "agent-kit",
): Promise<Record<string, unknown>> {
  let merged: Record<string, unknown> = {};
  let isFound = false;
  for (const name of LAYER_ORDER(env, appName)) {
    const layer = await readLayer(nodePath.join(dir, name));
    if (layer) {
      merged = deepMerge(merged, layer);
      isFound = true;
    }
  }
  if (!isFound) {
    throw new ConfigError({ message: `no config layers found in ${dir}` });
  }
  return merged;
}

/** Validate an already-interpolated source into a typed config. */
export function validate(interpolated: unknown): AgentKitConfig {
  const parsed = Schema.decodeUnknownResult(ConfigSchema)(interpolated);
  if (Result.isFailure(parsed)) {
    throw new ConfigError({
      message: `config validation failed: ${formatSchemaError(parsed.failure)}`,
    });
  }
  return parsed.success;
}

export async function loadConfig(opts: LoadOptions): Promise<LoadedConfig> {
  const resolver = opts.resolver ?? envResolver();
  const source = await mergeSource(
    opts.dir,
    opts.env,
    opts.appName ?? "agent-kit",
  );
  const interpolated = await interpolate(applyOverlay(source, opts), resolver);
  const config = validate(interpolated);
  // Snapshot the FILE-derived source only — the overlay is in-memory state.
  if (opts.snapshotPath) await writeSnapshot(opts.snapshotPath, source);
  return { config, source };
}

/** Deep-merge an in-memory overlay (agent-spec fragments) over the file layers. */
export function applyOverlay(
  source: Record<string, unknown>,
  opts: Pick<LoadOptions, "overlay">,
): Record<string, unknown> {
  return opts.overlay ? deepMerge(source, opts.overlay) : source;
}

/** Persist the pre-interpolation source as last-known-good (§5). */
export async function writeSnapshot(
  path: string,
  source: Record<string, unknown>,
): Promise<void> {
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(source), "utf8");
}

export async function readSnapshot(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  return readLayer(path);
}
