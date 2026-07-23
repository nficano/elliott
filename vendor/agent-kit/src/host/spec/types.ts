import type { ToolDef } from "../../core/agent/types.js";
import type { Tier } from "../../core/types.js";
import type { AgentKitOptions } from "../bootstrap/types.js";
import type { SecretResolver } from "../config/types.js";
import type { Job } from "../jobs/types.js";
import type { ErrorReporter } from "../observability/types.js";
import type { Active, Registrable, ScheduleSpec } from "../registry/types.js";
import type {
  AgentSpec as RuntimeAgentSpec,
  TurnInput,
  TurnResult,
} from "../runtime/types.js";
import type { UsesRef } from "./lock.js";
import type { ParsedUses } from "./refs.js";

// ── the agent-spec file (AGENT-SPEC §1), as decoded from agents/<name>.yaml ──

/** A `uses:`-style import (`tools:` / `mcp:` entries). */
export interface UsesImport {
  readonly uses: string;
  readonly with?: Record<string, unknown>;
  readonly secrets?: Record<string, string>;
}

/** GH-Actions-style per-domain trust level (AGENT-SPEC §1.3). */
export type PermissionLevel = "read" | "write" | "none";

/** A turn step's model override: a tier, or a tier + profile pair. */
export type TurnModelRef = Tier | {
  readonly tier: Tier;
  readonly profile?: string;
};

export interface TurnBlock {
  /** Prompt file path, resolved relative to assetsDir. */
  readonly prompt: string;
  readonly model?: TurnModelRef;
  readonly context?: Record<string, unknown>;
  /** Per-turn tool import overrides (accepted; not yet wired into runTurn). */
  readonly tools?: readonly UsesImport[];
}

export interface UsesStep {
  readonly id?: string;
  readonly uses: string;
  readonly with?: Record<string, unknown>;
  readonly secrets?: Record<string, string>;
}

export interface TurnStep {
  readonly id?: string;
  readonly turn: TurnBlock;
}

export type SpecStep = UsesStep | TurnStep;

export interface SpecJobTrigger {
  readonly schedule?: string;
  readonly manual?: boolean;
}

export interface SpecJob {
  readonly on: SpecJobTrigger;
  readonly steps: readonly SpecStep[];
}

/** `model:` — `default:` plus inline per-job tier overrides, never model ids. */
export interface SpecModelBlock {
  readonly default?: Tier;
  readonly [job: string]: Tier | undefined;
}

/** One YAML file defines one agent (AGENT-SPEC §1). */
export interface AgentSpecFile {
  readonly name: string;
  readonly persona?: string;
  readonly channels?: readonly string[];
  readonly model?: SpecModelBlock;
  /** Agent-personal data, referenced as `${{ config.* }}` — not framework config. */
  readonly config?: Record<string, unknown>;
  readonly mcp?: readonly UsesImport[];
  readonly permissions?: Record<string, PermissionLevel>;
  readonly tools?: readonly UsesImport[];
  readonly jobs?: Record<string, SpecJob>;
}

// ── `${{ }}` interpolation (two phases) ──

/** A dotted-path operand that must defer to runtime (`steps.*`). */
export interface PathOperand {
  readonly type: "path";
  readonly path: readonly string[];
}

/** An operand already resolved at load time (secrets/config). */
export interface ValueOperand {
  readonly type: "value";
  readonly value: unknown;
}

export type ExprOperand = PathOperand | ValueOperand;

export interface TextSegment {
  readonly type: "text";
  readonly text: string;
}

/** One `${{ … }}` occurrence: operands joined by binary `+`. */
export interface ExprSegment {
  readonly type: "expr";
  readonly operands: readonly ExprOperand[];
}

export type DeferredSegment = TextSegment | ExprSegment;

/**
 * A `${{ steps.* }}` expression that survived load and resolves during job
 * execution — attached in the tree exactly where the value goes.
 */
export interface DeferredExpr {
  readonly kind: "spec-expr";
  /** The original YAML scalar, for error messages. */
  readonly source: string;
  /** The spec file the expression came from. */
  readonly file: string;
  readonly segments: readonly DeferredSegment[];
}

/** Load-time interpolation contexts (phase 1). */
export interface SpecLoadContext {
  readonly file: string;
  readonly secrets: Record<string, string>;
  readonly config: Record<string, unknown>;
}

/** Runtime interpolation context (phase 2): step id → outputs. */
export interface SpecRuntimeContext {
  readonly steps: Record<string, unknown>;
}

// ── permissions (AGENT-SPEC §1.3) ──

export interface PermissionDecision {
  /** The uses ref this decision applies to. */
  readonly uses: string;
  /** Permission domain = the skill id named by the ref. */
  readonly domain: string;
  /** Effective level; unlisted domains default to "read". */
  readonly level: PermissionLevel;
  /** Whether the domain appears in the spec's `permissions:` block. */
  readonly listed: boolean;
  /** Write-tool gating: "gated" | "auto" (import's `with.approval`); null unless write. */
  readonly approval: "gated" | "auto" | null;
  readonly materializeTools: boolean;
  readonly materializeWriteTools: boolean;
}

export interface PermissionSummaryEntry {
  readonly domain: string;
  readonly level: PermissionLevel;
  readonly listed: boolean;
  readonly tools: boolean;
  readonly writeTools: "gated" | "auto" | "omitted";
}

export interface PermissionsResult {
  readonly decisions: readonly PermissionDecision[];
  /** Serializable summary keyed by the uses ref string. */
  readonly summary: Readonly<Record<string, PermissionSummaryEntry>>;
}

// ── the generated model-facing tool file (AGENT-SPEC §1.3) ──

export interface ToolFileEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly skill: string;
  readonly access: "read" | "write" | "write-auto";
}

export interface ToolFile {
  readonly agent: string;
  readonly generated_from: string;
  readonly tools: readonly ToolFileEntry[];
}

/** A tools/mcp import resolved to its registrables' contributed tools. */
export interface ResolvedImport {
  readonly uses: string;
  readonly parsed: ParsedUses;
  readonly domain: string;
  readonly decision: PermissionDecision;
  /** Unfiltered Active.tools across the import's registrables. */
  readonly tools: readonly ToolDef[];
  /** Unfiltered Active.writeTools across the import's registrables. */
  readonly writeTools: readonly ToolDef[];
}

// ── compiled jobs ──

export interface CompiledUsesStep {
  readonly type: "uses";
  readonly id: string;
  readonly uses: string;
  /** Registrable ids to activate, in resolution order. */
  readonly registrableIds: readonly string[];
  /** Tool-name candidates (refs.toolCandidates order). */
  readonly toolNames: readonly string[];
  /** Whether the step may run writeTools (permissions domain is `write`). */
  readonly allowWrite: boolean;
  /** Interpolated `with:` — may contain DeferredExpr nodes. */
  readonly args: unknown;
}

export interface CompiledTurnStep {
  readonly type: "turn";
  readonly id: string;
  /** Prompt file path relative to assetsDir. */
  readonly promptPath: string;
  readonly tier?: Tier;
  /** Interpolated `context:` — may contain DeferredExpr nodes. */
  readonly context?: unknown;
}

export type CompiledStep = CompiledUsesStep | CompiledTurnStep;

export interface CompiledJob {
  readonly agent: string;
  readonly job: string;
  /** `<agent>:<job>` — the ScheduleSpec id and `sched:` job kind suffix. */
  readonly id: string;
  readonly manual: boolean;
  readonly schedule?: ScheduleSpec;
  readonly steps: readonly CompiledStep[];
}

/** The registry surface the step executor needs (fake-able in tests). */
export interface SpecRegistryLike {
  activate(id: string): Promise<Active>;
}

/** The runtime surface a `turn:` step needs (fake-able in tests). */
export interface SpecRuntimeLike {
  runTurn(input: TurnInput): Promise<TurnResult>;
}

export interface SpecJobDeps {
  readonly registry: SpecRegistryLike;
  readonly runtime: SpecRuntimeLike;
  /** Base dir for `turn:` prompt file paths. */
  readonly assetsDir: string;
  /** GlitchTip capture at the spec-job seam (§12); absent in bare tests. */
  readonly reporter?: ErrorReporter;
}

/** The job-queue surface spec handlers register against. */
export interface SpecJobQueueLike {
  handle(kind: string, handler: (job: Job) => Promise<void>): void;
}

export interface CompileJobsParams {
  readonly agent: string;
  /** The phase-1-interpolated spec. */
  readonly spec: AgentSpecFile;
  /** Maps a parsed uses ref to activation-candidate registrable ids. */
  readonly resolveSkillIds: (parsed: ParsedUses) => readonly string[];
}

// ── loader ──

export interface SpecKitOptions {
  /** Consumer config tree (existing loader) + secrets.yaml. */
  readonly configDir: string;
  /** Directory holding agents/*.yaml. */
  readonly specsDir: string;
  /** Base for persona/prompt relative paths (default: dirname(specsDir)). */
  readonly assetsDir?: string;
  readonly env: string;
  readonly appName?: string;
  readonly resolver?: SecretResolver;
  /** Local skills, keyed by the "./path" string used in specs. */
  readonly localSkills?: Record<string, Registrable>;
  /** For ref resolution; default: this package's root. */
  readonly repoRoot?: string;
  /** Default: join(specsDir, "..", "agent-kit.lock"). */
  readonly lockfilePath?: string;
  /** Extra registrables, passed through (and importable by manifest id). */
  readonly registrables?: Registrable[];
}

/** Shared mutable state threaded through per-agent compilation. */
export interface CompileAgentContext {
  readonly assetsDir: string;
  readonly secrets: Record<string, string>;
  readonly catalog: SkillCatalog;
  readonly overlay: Record<string, unknown>;
  readonly refs: Map<string, UsesRef>;
  readonly warnings: string[];
  /** MCP server registrables materialized from `mcp:` imports, by id. */
  readonly mcpServers: Map<string, Registrable>;
}

/** Resolves `uses:` refs to registrables (builtins, localSkills, extras). */
export interface SkillCatalog {
  /** Registrables an import maps to (spec id `gmail` → the email pair). */
  resolve(parsed: ParsedUses): Registrable[];
  /** Every registrable a spec resolved — goes into AgentKitOptions.registrables. */
  used(): Registrable[];
  /** Importable ids/paths, for load-error messages. */
  available(): string[];
}

export interface CompiledAgent {
  readonly name: string;
  readonly file: string;
  /** Phase-1-interpolated spec (job step args may hold DeferredExpr nodes). */
  readonly spec: AgentSpecFile;
  readonly agent: RuntimeAgentSpec;
  readonly imports: readonly ResolvedImport[];
  readonly permissions: PermissionsResult;
  readonly toolFile: ToolFile;
  readonly jobs: readonly CompiledJob[];
}

export interface CompiledSpecKit {
  /** Ready for createAgentKit(). */
  readonly options: AgentKitOptions;
  readonly agents: readonly CompiledAgent[];
  readonly schedules: readonly ScheduleSpec[];
  readonly jobs: readonly CompiledJob[];
  /** Config fragments merged over the consumer tree (spec enablement wins). */
  readonly overlay: Record<string, unknown>;
  /** Every registry uses: ref that names a git tag (lockfile input). */
  readonly refs: readonly UsesRef[];
  readonly warnings: readonly string[];
  readonly specsDir: string;
  readonly assetsDir: string;
}
