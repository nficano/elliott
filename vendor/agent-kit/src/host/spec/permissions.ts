import type { ToolDef } from "../../core/agent/types.js";
import { parseUses } from "./refs.js";
import type {
  PermissionDecision,
  PermissionLevel,
  PermissionsResult,
  PermissionSummaryEntry,
  UsesImport,
} from "./types.js";

/**
 * `permissions:` semantics (AGENT-SPEC §1.3) — the trust boundary as data.
 * For each imported skill, the domain is the skill id:
 *
 *  - `read` (and the default when unlisted) → only `Active.tools` materialize;
 *    write tools never exist for that domain.
 *  - `write` → tools + writeTools materialize; writeTools are approval-gated
 *    unless that import declares `with: { approval: auto }` (low-stakes
 *    writes), which marks them pre-approved/ungated.
 *  - `none` → nothing materializes from that skill.
 */

export function applyPermissions(params: {
  readonly imports: readonly UsesImport[];
  readonly permissions?: Record<string, PermissionLevel>;
}): PermissionsResult {
  const decisions = params.imports.map((imp) =>
    decide(imp, params.permissions ?? {})
  );
  const summary: Record<string, PermissionSummaryEntry> = {};
  for (const d of decisions) summary[d.uses] = summarize(d);
  return { decisions, summary };
}

/** The effective level for a domain (unlisted defaults to read). */
export function permissionLevelFor(params: {
  readonly domain: string;
  readonly permissions?: Record<string, PermissionLevel>;
}): PermissionLevel {
  return params.permissions?.[params.domain] ?? "read";
}

function decide(
  imp: UsesImport,
  permissions: Record<string, PermissionLevel>,
): PermissionDecision {
  const parsed = parseUses(imp.uses);
  const domain = parsed.kind === "local" ? parsed.id : parsed.skill;
  const listed = domain in permissions;
  const level = permissions[domain] ?? "read";
  const isWrite = level === "write";
  const approval = isWrite
    ? (imp.with?.approval === "auto" ? "auto" : "gated")
    : null;
  return {
    uses: imp.uses,
    domain,
    level,
    listed,
    approval,
    materializeTools: level !== "none",
    materializeWriteTools: isWrite,
  };
}

function summarize(d: PermissionDecision): PermissionSummaryEntry {
  return {
    domain: d.domain,
    level: d.level,
    listed: d.listed,
    tools: d.materializeTools,
    writeTools: d.materializeWriteTools ? d.approval ?? "gated" : "omitted",
  };
}

/** Filter an import's contributed tools by its permission decision. */
export function materializedTools(params: {
  readonly decision: PermissionDecision;
  readonly tools: readonly ToolDef[];
  readonly writeTools: readonly ToolDef[];
}): { readonly tools: ToolDef[]; readonly writeTools: ToolDef[]; } {
  const { decision } = params;
  return {
    tools: decision.materializeTools ? [...params.tools] : [],
    writeTools: decision.materializeWriteTools ? [...params.writeTools] : [],
  };
}
