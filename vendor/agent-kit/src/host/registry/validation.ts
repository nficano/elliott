import type * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import type { ToolDef } from "../../core/agent/types.js";
import { ConfigError } from "../../core/errors.js";
import type { FootprintLedger } from "../footprint/types.js";
import type { Active, Manifest } from "./types.js";

const ESTIMATED_CHARACTERS_PER_TOKEN = 4;

export function crossCheckContracts(m: Manifest, active: Active): void {
  const declared = m.contracts?.tools ?? [];
  if (declared.length === 0) return;
  const actual = new Set(
    (active.tools ?? []).concat(active.writeTools ?? []).map((tool) =>
      tool.name
    ),
  );
  for (const name of declared) {
    if (!actual.has(name)) {
      throw new ConfigError({
        message: `'${m.id}' claims tool '${name}' but never registered it (§6)`,
      });
    }
  }
}

export function crossCheckProviders(m: Manifest, active: Active): void {
  const declared = m.provides ?? [];
  if (declared.length === 0) return;
  const actual = new Set(
    (active.providers ?? []).map((provider) => provider.capability),
  );
  for (const declaration of declared) {
    if (!actual.has(declaration.capability)) {
      throw new ConfigError({
        message:
          `'${m.id}' declares provider for '${declaration.capability}' but never registered it`,
      });
    }
  }
}

export function claimTools(
  id: string,
  active: Active,
  owner: Map<string, string>,
): void {
  for (const tool of (active.tools ?? []).concat(active.writeTools ?? [])) {
    const existing = owner.get(tool.name);
    if (existing && existing !== id) {
      throw new ConfigError({
        message:
          `tool '${tool.name}' claimed by both '${existing}' and '${id}' (§6)`,
      });
    }
    owner.set(tool.name, id);
  }
}

export function recordStatic(
  footprint: FootprintLedger,
  id: string,
  active: Active,
): void {
  const tools: ToolDef[] = (active.tools ?? []).concat(active.writeTools ?? []);
  const schemaTokens = tools.reduce(
    (total, tool) => total + (tool.meta.cold_tokens ?? 0),
    0,
  );
  const promptTokens = active.promptFragment
    ? Math.ceil(
      active.promptFragment.text.length / ESTIMATED_CHARACTERS_PER_TOKEN,
    )
    : 0;
  footprint.recordStatic({
    componentId: id,
    schemaTokens,
    promptTokens,
    coldTokens: schemaTokens + promptTokens,
  });
}

export function formatIssues(error: Schema.SchemaError): string {
  return SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
    .map((issue) => issue.message)
    .join("; ");
}
