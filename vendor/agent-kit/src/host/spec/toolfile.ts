import type { ToolDef } from "../../core/agent/types.js";
import type {
  PermissionDecision,
  ResolvedImport,
  ToolFile,
  ToolFileEntry,
} from "./types.js";

/**
 * The GENERATED model-facing tool file (AGENT-SPEC §1.3) — the successor to
 * oslo's handwritten `tools.allow` and tme's `toolFilter` prefixes. Built from
 * the spec's `tools:` imports filtered by `permissions:`; written to
 * `<specsDir>/<name>.tools.json` by the loader (this module stays pure) as the
 * inspectable artifact.
 */

export function buildToolFile(params: {
  readonly agent: string;
  readonly imports: readonly ResolvedImport[];
}): ToolFile {
  const entries: ToolFileEntry[] = [];
  const seen = new Set<string>();
  for (const imp of params.imports) {
    for (const entry of importEntries(imp)) {
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push(entry);
    }
  }
  entries.sort(byToolKey);
  return {
    agent: params.agent,
    generated_from: `agents/${params.agent}.yaml`,
    tools: entries,
  };
}

export function serializeToolFile(toolFile: ToolFile): string {
  return `${JSON.stringify(toolFile, null, 2)}\n`;
}

function importEntries(imp: ResolvedImport): ToolFileEntry[] {
  const { decision } = imp;
  const entries: ToolFileEntry[] = [];
  if (decision.materializeTools) {
    for (const tool of imp.tools) {
      entries.push(entry({ tool, decision, access: "read" }));
    }
  }
  if (decision.materializeWriteTools) {
    const access = decision.approval === "auto" ? "write-auto" : "write";
    for (const tool of imp.writeTools) {
      entries.push(entry({ tool, decision, access }));
    }
  }
  return entries;
}

function entry(params: {
  readonly tool: ToolDef;
  readonly decision: PermissionDecision;
  readonly access: ToolFileEntry["access"];
}): ToolFileEntry {
  return {
    name: params.tool.name,
    description: params.tool.description,
    parameters: params.tool.parameters,
    skill: params.decision.domain,
    access: params.access,
  };
}

function byToolKey(a: ToolFileEntry, b: ToolFileEntry): number {
  const ka = `${a.skill}\u0000${a.name}`;
  const kb = `${b.skill}\u0000${b.name}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
