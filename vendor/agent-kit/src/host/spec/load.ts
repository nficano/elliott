import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import {
  ErrorReporterSvc,
  JobsSvc,
  RegistrySvc,
} from "../../core/di/services.js";
import { errorMessage } from "../../core/errors.js";
import type { AgentKit, AgentKitOptions } from "../bootstrap/types.js";
import { envResolver, interpolate } from "../config/interpolate.js";
import { deepMerge, mergeSource, validate } from "../config/load.js";
import type { Registrable, ScheduleSpec } from "../registry/types.js";
import { builtinSkillTreePath } from "./builtins.js";
import {
  compileAgentFile,
  loadSpecSecrets,
  makeSkillCatalog,
  SpecLoadError,
} from "./compile.js";
import { registerSpecJobHandlers } from "./jobs.js";
import type { GitResolver, Lockfile, UsesRef } from "./lock.js";
import {
  gitResolver,
  LOCKFILE_NAME,
  parseLockfile,
  resolveRefs,
  serializeLockfile,
  verifyAgainstHead,
} from "./lock.js";
import { serializeToolFile } from "./toolfile.js";
import type {
  CompileAgentContext,
  CompiledAgent,
  CompiledSpecKit,
  SpecKitOptions,
} from "./types.js";

export { SpecLoadError } from "./compile.js";

/**
 * The consumer entrypoints (AGENT-SPEC §1): read `agents/*.yaml`, validate,
 * interpolate (`${{ secrets.* }}` / `${{ config.* }}` eagerly; `${{ steps.* }}`
 * deferred), and compile onto the existing runtime:
 *
 *  - runtime `AgentSpec[]` (id/persona/tier/trust),
 *  - config fragments merged OVER the consumer tree (spec enablement wins),
 *  - durable ScheduleSpecs + per-job step executors,
 *  - the generated model-facing tool files (`<specsDir>/<name>.tools.json`),
 *  - the ref lockfile (AGENT-SPEC §1.4; drift vs installed HEAD = warning).
 */

/** Pure-ish compile (reads spec/config files; writes nothing, boots nothing). */
export async function compileAgentSpecs(
  opts: SpecKitOptions,
): Promise<CompiledSpecKit> {
  const specsDir = nodePath.resolve(opts.specsDir);
  const assetsDir = opts.assetsDir
    ? nodePath.resolve(opts.assetsDir)
    : nodePath.dirname(specsDir);
  const files = await specFiles(specsDir);
  const ctx: CompileAgentContext = {
    assetsDir,
    secrets: await loadSpecSecrets({
      configDir: opts.configDir,
      ...(opts.resolver && { resolver: opts.resolver }),
    }),
    catalog: makeSkillCatalog(opts),
    overlay: {},
    refs: new Map<string, UsesRef>(),
    warnings: [],
    mcpServers: new Map<string, Registrable>(),
  };
  const agents: CompiledAgent[] = [];
  for (const file of files) {
    agents.push(
      await compileAgentFile({
        path: nodePath.join(specsDir, file),
        file,
        ctx,
      }),
    );
  }
  assertUniqueAgentNames(agents);
  const schedules = agents.flatMap((a) =>
    a.jobs.flatMap((j) => j.schedule ? [j.schedule] : [])
  );
  const options = buildOptions({ opts, ctx, agents, schedules });
  await checkMergedConfig(opts, ctx.overlay);
  return {
    options,
    agents,
    schedules,
    jobs: agents.flatMap((a) => a.jobs),
    overlay: ctx.overlay,
    refs: [...ctx.refs.values()],
    warnings: ctx.warnings,
    specsDir,
    assetsDir,
  };
}

/** Compile + write the inspectable artifacts (tool files, lockfile). */
export async function loadAgentSpecs(
  opts: SpecKitOptions,
): Promise<CompiledSpecKit> {
  const compiled = await compileAgentSpecs(opts);
  for (const agent of compiled.agents) {
    await writeFile(
      nodePath.join(compiled.specsDir, `${agent.name}.tools.json`),
      serializeToolFile(agent.toolFile),
      "utf8",
    );
  }
  const warnings = [
    ...compiled.warnings,
    ...(await syncLockfile({ opts, compiled })),
  ];
  for (const warning of warnings) console.warn(`[agent-spec] ${warning}`);
  return { ...compiled, warnings };
}

/** Compile, boot the kit, and wire spec-job step executors into the scheduler path. */
export async function createAgentKitFromSpecs(
  opts: SpecKitOptions,
): Promise<AgentKit> {
  const compiled = await loadAgentSpecs(opts);
  // Deferred import: compiling/loading specs must not pull in the full boot
  // graph (OTel SDK, Postgres, …) — only actually booting the kit does.
  const { createAgentKit } = await import("../bootstrap.js");
  const kit = await createAgentKit(compiled.options);
  registerSpecJobHandlers({
    jobs: kit.get(JobsSvc),
    compiled: compiled.jobs,
    deps: {
      registry: kit.get(RegistrySvc),
      runtime: kit.runtime,
      assetsDir: compiled.assetsDir,
      reporter: kit.get(ErrorReporterSvc),
    },
  });
  return kit;
}

async function specFiles(specsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(specsDir);
  } catch {
    throw new SpecLoadError(`specs directory not found: ${specsDir}`);
  }
  const files = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new SpecLoadError(`no agent specs (*.yaml) in ${specsDir}`);
  }
  return files;
}

function assertUniqueAgentNames(agents: readonly CompiledAgent[]): void {
  const seen = new Map<string, string>();
  for (const agent of agents) {
    const prior = seen.get(agent.name);
    if (prior !== undefined) {
      throw new SpecLoadError(
        `agent "${agent.name}" is defined by both ${prior} and ${agent.file}`,
      );
    }
    seen.set(agent.name, agent.file);
  }
}

function buildOptions(params: {
  readonly opts: SpecKitOptions;
  readonly ctx: CompileAgentContext;
  readonly agents: readonly CompiledAgent[];
  readonly schedules: ScheduleSpec[];
}): AgentKitOptions {
  const { opts, ctx, agents, schedules } = params;
  const registrables = dedupeRegistrables([
    ...ctx.catalog.used(),
    ...ctx.mcpServers.values(),
    ...(opts.registrables ?? []),
  ]);
  return {
    configDir: opts.configDir,
    env: opts.env,
    ...(opts.appName && { appName: opts.appName }),
    ...(opts.resolver && { resolver: opts.resolver }),
    configOverlay: ctx.overlay,
    registrables,
    agents: agents.map((a) => a.agent),
    schedules,
  };
}

function dedupeRegistrables(regs: readonly Registrable[]): Registrable[] {
  return [...new Set(regs)];
}

/** Fail-fast: the overlay merged over the consumer tree must decode (§5). */
async function checkMergedConfig(
  opts: SpecKitOptions,
  overlay: Record<string, unknown>,
): Promise<void> {
  try {
    const source = await mergeSource(
      opts.configDir,
      opts.env,
      opts.appName ?? "agent-kit",
    );
    const merged = deepMerge(source, overlay);
    validate(await interpolate(merged, opts.resolver ?? envResolver()));
  } catch (error) {
    throw new SpecLoadError(
      `consumer config + spec enablement failed to validate: ${
        errorMessage(error)
      }`,
    );
  }
}

/**
 * Lockfile flow (AGENT-SPEC §1.4): verify an existing lock against the
 * installed HEAD (drift = warning, never a hard pin), resolve any refs not yet
 * locked (missing tag = hard failure), and write the merged lockfile.
 */
async function syncLockfile(params: {
  readonly opts: SpecKitOptions;
  readonly compiled: CompiledSpecKit;
}): Promise<string[]> {
  const { opts, compiled } = params;
  const lockfilePath = opts.lockfilePath
    ?? nodePath.join(compiled.specsDir, "..", LOCKFILE_NAME);
  const hasLock = existsSync(lockfilePath);
  if (compiled.refs.length === 0 && !hasLock) return []; // refless dev mode
  const git = gitResolver(opts.repoRoot ?? defaultRepoRoot());
  const warnings: string[] = [];
  let lock: Lockfile | undefined;
  if (hasLock) {
    lock = parseLockfile(await readFile(lockfilePath, "utf8"));
    warnings.push(...(await verifyAgainstHead(lock, git)));
  }
  const locked = new Set(
    (lock?.entries ?? []).map((e) => `${e.skill}@${e.ref}`),
  );
  const missing = compiled.refs.filter(
    (r) => !locked.has(`${r.skill}@${r.ref}`),
  );
  if (missing.length > 0) {
    await lockMissingRefs({ lockfilePath, lock, missing, git });
  }
  return warnings;
}

/** Resolve not-yet-locked refs and write the merged lockfile. */
async function lockMissingRefs(params: {
  readonly lockfilePath: string;
  readonly lock: Lockfile | undefined;
  readonly missing: UsesRef[];
  readonly git: GitResolver;
}): Promise<void> {
  const { lockfilePath, lock, missing, git } = params;
  const fresh = await resolveRefs(missing, git, builtinSkillTreePath);
  const merged: Lockfile = {
    version: 1,
    entries: [...(lock?.entries ?? []), ...fresh.entries],
  };
  await writeFile(lockfilePath, serializeLockfile(merged), "utf8");
}

/** This package's root (src/host/spec → three levels up). */
function defaultRepoRoot(): string {
  return nodePath.resolve(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
}
