import type { ToolDef } from "../core/agent/types.js";
import type { ServiceGet } from "../core/di/services.js";
import type {
  ComponentReport,
  FootprintLedger,
  StaticFootprint,
} from "../host/footprint/types.js";
import { NoopObservability } from "../host/observability/observability.js";
import { makeRegistry } from "../host/registry/registry.js";
import type {
  FootprintGateOptions,
  FootprintGateReport,
  SchemaLint,
} from "./types.js";

const EXPOSED_BUNDLE_COUNT = 3;

/**
 * The FREE static footprint gate (§11.3). Runs on EVERY PR with $0 and no LLM
 * calls: cold-token regression is a pure static computation over registered
 * schemas. Also lints every derived JSON Schema against provider constraints
 * (§20). Making it free is what makes it run on every PR — the whole point.
 */
class MemLedger implements FootprintLedger {
  readonly statics = new Map<string, StaticFootprint>();
  recordStatic(f: StaticFootprint): void {
    this.statics.set(f.componentId, f);
  }
  async recordDynamic(): Promise<void> {}
  async report(): Promise<ComponentReport[]> {
    return [];
  }
  exposedColdTokens(ids: string[]): number {
    return ids.reduce(
      (n, id) => n + (this.statics.get(id)?.coldTokens ?? 0),
      0,
    );
  }
}

export async function runFootprintGate(
  opts: FootprintGateOptions,
): Promise<FootprintGateReport> {
  // The static gate provides no runtime services; a skill that reaches for one
  // during activation fails to activate (caught below) — same as the old
  // empty-container behavior. Cold-token accounting needs only the schemas.
  const get: ServiceGet = (tag) => {
    throw new Error(
      `footprint gate: service '${tag.key}' unavailable (static gate has no runtime services)`,
    );
  };
  const obs = new NoopObservability();
  const footprint = new MemLedger();
  const registry = makeRegistry({ config: opts.config, get, obs, footprint });
  registry.index(opts.registrables);
  const allTools = await activateTools(registry, opts.coreTools ?? []);
  const { coreCold, perBundle } = summarizeTools(allTools);
  const worstCaseExposed = coreCold
    + perBundle.slice(0, EXPOSED_BUNDLE_COUNT).reduce(
      (total, bundle) => total + bundle.coldTokens,
      0,
    );
  const max = opts.config.budgets.cold_tokens_max;
  const budgetViolations = budgetFailures({ coreCold, worstCaseExposed, max });
  const schemaLints = allTools.flatMap((tool) =>
    lintSchema(tool.name, tool.parameters)
  );
  return {
    pass: budgetViolations.length === 0 && schemaLints.length === 0,
    coldTokensMax: max,
    coreColdTokens: coreCold,
    perBundle,
    worstCaseExposed,
    budgetViolations,
    schemaLints,
  };
}

async function activateTools(
  registry: ReturnType<typeof makeRegistry>,
  coreTools: readonly ToolDef[],
): Promise<ToolDef[]> {
  // Activation is cheap (no network — clients resolve lazily at first tool run).
  const allTools: ToolDef[] = [...coreTools];
  for (const entry of registry.all()) {
    if (!entry.enabled) continue;
    const kind = entry.registrable.manifest.kind;
    if (kind === "channel" || kind === "plugin") continue;
    try {
      const active = await registry.activate(entry.registrable.manifest.id);
      allTools.push(...(active.tools ?? []), ...(active.writeTools ?? []));
    } catch {
      /* a registrable that fails to activate is a separate (config) failure */
    }
  }
  return allTools;
}

function summarizeTools(allTools: readonly ToolDef[]) {
  const byBundle = new Map<string, { cold: number; tools: number; }>();
  let coreCold = 0;
  for (const tool of allTools) {
    const cold = tool.meta.cold_tokens ?? 0;
    if (tool.meta.core) coreCold += cold;
    else {
      const bundle = byBundle.get(tool.meta.bundle) ?? { cold: 0, tools: 0 };
      bundle.cold += cold;
      bundle.tools++;
      byBundle.set(tool.meta.bundle, bundle);
    }
  }
  const perBundle = [...byBundle]
    .map(([bundle, value]) => ({
      bundle,
      coldTokens: value.cold,
      tools: value.tools,
    }))
    .sort((a, b) => b.coldTokens - a.coldTokens);
  return { coreCold, perBundle };
}

function budgetFailures(params: {
  readonly coreCold: number;
  readonly worstCaseExposed: number;
  readonly max: number;
}): string[] {
  const budgetViolations: string[] = [];
  if (params.coreCold > params.max) {
    budgetViolations.push(
      `core tools ${params.coreCold} > cold_tokens_max ${params.max}`,
    );
  }
  if (params.worstCaseExposed > params.max) {
    budgetViolations.push(
      `worst-case exposed (core + top-${EXPOSED_BUNDLE_COUNT} bundles) ${params.worstCaseExposed} > cold_tokens_max ${params.max}`,
    );
  }
  return budgetViolations;
}

/**
 * Lint a derived JSON Schema against provider constraints (§20). Unions/records/
 * top-level `anyOf` produce schemas some providers reject.
 */
export function lintSchema(
  tool: string,
  schema: Record<string, unknown>,
): SchemaLint[] {
  const out: SchemaLint[] = [];
  if (schema.type !== "object") {
    out.push({
      tool,
      issue: `root type is '${String(schema.type)}', not 'object'`,
    });
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (key in schema) {
      out.push({
        tool,
        issue: `top-level '${key}' — some providers reject non-object roots`,
      });
    }
  }
  if (JSON.stringify(schema).includes("\"$ref\"")) {
    out.push({
      tool,
      issue: "schema contains $ref — inline it ($refStrategy: none)",
    });
  }
  return out;
}

/** Print a gate report and return a process exit code (0 pass, 1 fail). */
export function reportGate(r: FootprintGateReport): number {
  console.info(
    `footprint gate: core=${r.coreColdTokens} worst-case=${r.worstCaseExposed} / max=${r.coldTokensMax}`,
  );
  for (const b of r.perBundle) {
    console.info(
      `  bundle ${b.bundle}: ${b.coldTokens} cold tokens (${b.tools} tools)`,
    );
  }
  for (const v of r.budgetViolations) console.error(`  BUDGET: ${v}`);
  for (const l of r.schemaLints) {
    console.error(`  SCHEMA ${l.tool}: ${l.issue}`);
  }
  console.info(r.pass ? "footprint gate: PASS" : "footprint gate: FAIL");
  return r.pass ? 0 : 1;
}
