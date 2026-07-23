import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { parse as parseYaml } from "yaml";
import type { ToolDef } from "../../core/agent/types.js";
import type { ServiceGet } from "../../core/di/services.js";
import { envResolver, interpolate } from "../config/interpolate.js";
import { deepMerge } from "../config/load.js";
import type { SecretResolver } from "../config/types.js";
import { mcpServer } from "../mcp/registrable.js";
import type { Active, Registrable } from "../registry/types.js";
import type { AgentSpec as RuntimeAgentSpec } from "../runtime/types.js";
import { builtinSkillFactories } from "./builtins.js";
import { interpolateSpecTree } from "./interpolate.js";
import { compileJobs } from "./jobs.js";
import type { UsesRef } from "./lock.js";
import { applyPermissions } from "./permissions.js";
import type { ParsedUses } from "./refs.js";
import { parseUses } from "./refs.js";
import { parseAgentSpec } from "./schema.js";
import { buildToolFile } from "./toolfile.js";
import type {
  AgentSpecFile,
  CompileAgentContext,
  CompiledAgent,
  ResolvedImport,
  SkillCatalog,
  SpecKitOptions,
  UsesImport,
} from "./types.js";

/** Internal compile machinery for load.ts (one agent file → CompiledAgent). */

export class SpecLoadError extends Error {}

const DEFAULT_MAX_ROUNDS = 8;

export function makeSkillCatalog(opts: SpecKitOptions): SkillCatalog {
  const factories = builtinSkillFactories();
  const cache = new Map<string, Registrable[]>();
  const extras = new Map<string, Registrable>();
  for (const reg of opts.registrables ?? []) extras.set(reg.manifest.id, reg);
  const local = opts.localSkills ?? {};
  const usedSet = new Set<Registrable>();
  const available = (): string[] =>
    [
      ...new Set([
        ...Object.keys(factories),
        ...extras.keys(),
        ...Object.keys(local),
      ]),
    ].sort();
  return {
    available,
    used: () => [...usedSet],
    resolve(parsed: ParsedUses): Registrable[] {
      if (parsed.kind === "local") {
        const reg = local[parsed.path];
        if (!reg) {
          throw new SpecLoadError(
            `no local skill registered for "${parsed.path}" — pass it via `
              + `localSkills; available: [${available().join(", ")}]`,
          );
        }
        usedSet.add(reg);
        return [reg];
      }
      const extra = extras.get(parsed.skill);
      if (extra) {
        usedSet.add(extra);
        return [extra];
      }
      const factory = factories[parsed.skill];
      if (factory) {
        const regs = cache.get(parsed.skill) ?? factory();
        cache.set(parsed.skill, regs);
        for (const reg of regs) usedSet.add(reg);
        return regs;
      }
      throw new SpecLoadError(
        `uses: names skill "${parsed.skill}" but there is no builtin, no `
          + `localSkills entry, and no registrables match; available: [${
            available().join(", ")
          }]`,
      );
    },
  };
}

/** configDir/secrets.yaml → flat name→value map, `${VAULT/ENV}`-resolved. */
export async function loadSpecSecrets(params: {
  readonly configDir: string;
  readonly resolver?: SecretResolver;
}): Promise<Record<string, string>> {
  const path = nodePath.join(params.configDir, "secrets.yaml");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const parsed = parseYaml(text) as unknown;
  if (parsed === null || parsed === undefined) return {};
  if (!isRecord(parsed)) {
    throw new SpecLoadError(`${path} must be a flat name: value mapping`);
  }
  const resolved = await interpolate(parsed, params.resolver ?? envResolver());
  const out: Record<string, string> = {};
  for (
    const [name, value] of Object.entries(resolved as Record<string, unknown>)
  ) {
    if (typeof value !== "string") {
      throw new SpecLoadError(
        `${path}: secret "${name}" must resolve to a string`,
      );
    }
    out[name] = value;
  }
  return out;
}

export async function compileAgentFile(params: {
  readonly path: string;
  readonly file: string;
  readonly ctx: CompileAgentContext;
}): Promise<CompiledAgent> {
  const { path, file, ctx } = params;
  const raw = parseYaml(await readFile(path, "utf8")) as unknown;
  const validated = parseAgentSpec({ file, raw });
  const spec = interpolateSpecTree(validated, {
    file,
    secrets: ctx.secrets,
    config: (validated.config ?? {}),
  }) as AgentSpecFile;
  const agent = await runtimeAgentSpec({ spec, file, ctx });
  const permissions = applyPermissions({
    imports: spec.tools ?? [],
    ...(spec.permissions && { permissions: spec.permissions }),
  });
  const imports = await resolveToolImports({ spec, file, ctx, permissions });
  for (const imp of spec.mcp ?? []) {
    const id = addMcpFragment(ctx.overlay, imp);
    if (!ctx.mcpServers.has(id)) {
      const bundle = typeof imp.with?.["bundle"] === "string"
        ? imp.with["bundle"]
        : undefined;
      ctx.mcpServers.set(id, mcpServer({ id, ...(bundle && { bundle }) }));
    }
  }
  collectJobStepUses({ spec, ctx });
  const jobs = compileJobs({
    agent: spec.name,
    spec,
    resolveSkillIds: (parsed) =>
      ctx.catalog.resolve(parsed).map((r) => r.manifest.id),
  });
  const toolFile = buildToolFile({ agent: spec.name, imports });
  return {
    name: spec.name,
    file,
    spec,
    agent,
    imports,
    permissions,
    toolFile,
    jobs,
  };
}

async function runtimeAgentSpec(params: {
  readonly spec: AgentSpecFile;
  readonly file: string;
  readonly ctx: CompileAgentContext;
}): Promise<RuntimeAgentSpec> {
  const { spec, file, ctx } = params;
  const trust = Object.values(spec.permissions ?? {}).includes("write")
    ? "write"
    : "read";
  return {
    id: spec.name,
    persona: await loadPersona({ spec, file, assetsDir: ctx.assetsDir }),
    tier: spec.model?.default ?? "fast",
    maxRounds: DEFAULT_MAX_ROUNDS,
    trust,
  };
}

async function loadPersona(params: {
  readonly spec: AgentSpecFile;
  readonly file: string;
  readonly assetsDir: string;
}): Promise<string> {
  const { spec, file, assetsDir } = params;
  if (spec.persona === undefined) return `You are ${spec.name}.`;
  const path = nodePath.join(assetsDir, spec.persona);
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new SpecLoadError(
      `${file}: agent "${spec.name}" persona file not found: ${path}`,
    );
  }
}

async function resolveToolImports(params: {
  readonly spec: AgentSpecFile;
  readonly file: string;
  readonly ctx: CompileAgentContext;
  readonly permissions: ReturnType<typeof applyPermissions>;
}): Promise<ResolvedImport[]> {
  const { spec, file, ctx, permissions } = params;
  const imports: ResolvedImport[] = [];
  const toolImports = spec.tools ?? [];
  for (const [index, imp] of toolImports.entries()) {
    const decision = permissions.decisions[index]!;
    const parsed = parseUses(imp.uses);
    const regs = ctx.catalog.resolve(parsed);
    addSkillFragments({
      overlay: ctx.overlay,
      regs,
      withCfg: imp.with,
      secrets: imp.secrets,
    });
    addRef(ctx.refs, parsed);
    const { tools, writeTools } = await inventoryImportTools({
      regs,
      imp,
      file,
      warnings: ctx.warnings,
    });
    imports.push({
      uses: imp.uses,
      parsed,
      domain: decision.domain,
      decision,
      tools,
      writeTools,
    });
  }
  return imports;
}

/** Job `uses:` steps also enable their skills + pin their refs. */
function collectJobStepUses(params: {
  readonly spec: AgentSpecFile;
  readonly ctx: CompileAgentContext;
}): void {
  const { spec, ctx } = params;
  for (const job of Object.values(spec.jobs ?? {})) {
    for (const step of job.steps) {
      if (!("uses" in step)) continue;
      const parsed = parseUses(step.uses);
      const regs = ctx.catalog.resolve(parsed);
      addSkillFragments({ overlay: ctx.overlay, regs, secrets: step.secrets });
      addRef(ctx.refs, parsed);
    }
  }
}

function addSkillFragments(params: {
  readonly overlay: Record<string, unknown>;
  readonly regs: readonly Registrable[];
  readonly withCfg?: Record<string, unknown> | undefined;
  readonly secrets?: Record<string, string> | undefined;
}): void {
  for (const reg of params.regs) {
    const section = reg.manifest.kind === "mcp" ? "mcp" : "skills";
    writeFragment({
      overlay: params.overlay,
      section,
      id: reg.manifest.id,
      withCfg: params.withCfg,
      secrets: params.secrets,
    });
  }
}

function addMcpFragment(
  overlay: Record<string, unknown>,
  imp: UsesImport,
): string {
  const parsed = parseUses(imp.uses);
  const id = parsed.kind === "local"
    ? parsed.id
    : parsed.op ?? parsed.skill;
  writeFragment({
    overlay,
    section: "mcp",
    id,
    withCfg: imp.with,
    secrets: imp.secrets,
  });
  return id;
}

function writeFragment(params: {
  readonly overlay: Record<string, unknown>;
  readonly section: string;
  readonly id: string;
  readonly withCfg?: Record<string, unknown> | undefined;
  readonly secrets?: Record<string, string> | undefined;
}): void {
  const sectionMap = (params.overlay[params.section] ??= {}) as Record<
    string,
    unknown
  >;
  const hasSecrets = params.secrets && Object.keys(params.secrets).length > 0;
  const block = {
    enabled: true,
    ...params.withCfg,
    ...(hasSecrets && { secrets: params.secrets }),
  };
  const existing = sectionMap[params.id];
  sectionMap[params.id] = isRecord(existing)
    ? deepMerge(existing, block)
    : block;
}

function addRef(refs: Map<string, UsesRef>, parsed: ParsedUses): void {
  if (parsed.kind !== "registry" || parsed.ref === undefined) return;
  refs.set(`${parsed.skill}@${parsed.ref}`, {
    skill: parsed.skill,
    ref: parsed.ref,
  });
}

/**
 * Inventory an import's tools by activating outside the booted app: the
 * generated tool file needs each tool's name/description/parameters, which
 * only `activate()` yields. Services are unavailable — a skill whose activate
 * needs them degrades to a warning and contributes no tool-file entries.
 */
async function inventoryImportTools(params: {
  readonly regs: readonly Registrable[];
  readonly imp: UsesImport;
  readonly file: string;
  readonly warnings: string[];
}): Promise<{ tools: ToolDef[]; writeTools: ToolDef[]; }> {
  const tools: ToolDef[] = [];
  const writeTools: ToolDef[] = [];
  for (const reg of params.regs) {
    const active = await tryInventoryActivate(reg, params);
    if (!active) continue;
    tools.push(...(active.tools ?? []));
    writeTools.push(...(active.writeTools ?? []));
    try {
      await active.stop?.();
    } catch {
      // Best-effort teardown of the inventory activation.
    }
  }
  return { tools, writeTools };
}

async function tryInventoryActivate(
  reg: Registrable,
  params: {
    readonly imp: UsesImport;
    readonly file: string;
    readonly warnings: string[];
  },
): Promise<Active | undefined> {
  const manifest = reg.manifest;
  const block = {
    enabled: true,
    ...params.imp.with,
    ...(params.imp.secrets && { secrets: params.imp.secrets }),
  };
  const parsed = Schema.decodeUnknownResult(manifest.configSchema)(block);
  const config = Result.isSuccess(parsed) && isRecord(parsed.success)
    ? parsed.success
    : block;
  try {
    return await reg.activate({
      config,
      get: inventoryGet,
      tier: manifest.defaultTier ?? "fast",
      profile: manifest.defaultProfile ?? {},
      secrets: params.imp.secrets ?? {},
    });
  } catch (error) {
    params.warnings.push(
      `${params.file}: could not inventory tools for "${manifest.id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

const inventoryGet: ServiceGet = (key) => {
  throw new Error(
    `service ${key.key} is unavailable during spec compile (tool inventory)`,
  );
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
