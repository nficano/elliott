import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Observability } from "../../host/observability/types.js";
import type {
  BudgetAccumulator,
  SteeringChannel,
} from "../../host/runtime/types.js";
import type { ToolError } from "../errors.js";
import type { LlmPort, StreamTurnResult, ToolSchema } from "../llm/types.js";
import type {
  ChatMessage,
  ModelChoice,
  Origin,
  Trust,
  Usage,
} from "../types.js";

/**
 * A tool as the runtime holds it (§7.2). `execute` returns an `Effect` in the
 * typed error channel (`ToolError`); the dispatch layer runs it and serializes
 * failures to `{"error": …}` strings for the model. Every tool is tagged with
 * its owning registrable id + bundle → attribution for the footprint ledger.
 */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema, derived from the Effect Schema
  /** Decode + run; args are the model's raw JSON, decoded against the schema. */
  execute(args: unknown, ctx: ToolCtx): Effect.Effect<string, ToolError>;
  /** Attribution + routing metadata. */
  readonly meta: ToolMeta;
}

export interface ToolMeta {
  /** Owning registrable id (§26 kebab). */
  readonly componentId: string;
  /** Bundle this tool joins (§10.1), or "core" for always-loaded tools. */
  readonly bundle: string;
  /** Core tools are never deferred behind the search meta-tool (§10.1). */
  readonly core: boolean;
  /** Write tools live in a separate registry behind the approval gate (§16). */
  readonly write: boolean;
  /** Cold-token cost of this tool's schema, filled at registration (§11.1). */
  cold_tokens?: number;
}

/** Per-call context handed to a tool's `run`/`execute`. */
export interface ToolCtx {
  readonly traceId: string;
  readonly sessionId: string;
  readonly conversationKey: string;
  /** Provenance of the triggering turn (§16 untrusted-surface pinning). */
  readonly origin: Origin;
  readonly signal?: AbortSignal;
  /** Emit a steering message back into the running turn (§7.3). */
  steer?(text: string): void;
  /** Call chain so far (CAPABILITIES-TDD §8); tools extend it into nested calls. */
  readonly chain?: CallChain;
}

/** The model-facing projection of a ToolDef (what goes on the wire). */
export function toSchema(t: ToolDef): ToolSchema {
  return { name: t.name, description: t.description, parameters: t.parameters };
}

/** Descriptions live in disk YAML (§7.2, §12.2), keyed by tool name. */
export interface ToolDescriptions {
  /** One-line "when to use / prefer over X" + a ~40–60-word why. */
  readonly [toolName: string]: string;
}

/**
 * `define(spec)` — an Effect `Schema` is the source of truth: the model-facing
 * JSON Schema is derived from it (§7.2), and inbound args are decoded against it
 * before `run`. Authoring stays ergonomic — `run` is an async handler that
 * `define` lifts into the tool's `Effect` boundary.
 */
export interface DefineToolSpec<In> {
  readonly name: string;
  readonly description: string;
  readonly schema: Schema.Decoder<In>;
  readonly meta: Omit<ToolMeta, "cold_tokens">;
  run(args: In, ctx: ToolCtx): Promise<string>;
}

/** Trust-tagged tool group as contributed by a registrable (§6 Active). */
export interface ToolContribution {
  readonly tools: ToolDef[];
  readonly writeTools: ToolDef[];
  readonly trust: Trust;
}

// ── call-chain tracing (CAPABILITIES-TDD §8) — see chain.ts for the operations ──

export type HopKind = "turn" | "tool" | "capability" | "provider" | "job";

export interface Hop {
  readonly kind: HopKind;
  /** `page-fetch@1`, `firecrawl@0.1.0`, a tool name, a job kind… (§26.6). */
  readonly ref: string;
  readonly note?: string;
}

export type CallChain = readonly Hop[];

// ── agent loop (§7.3) — see run-agent.ts for the loop itself ──

export interface ModelCallInfo {
  readonly round: number;
  readonly model: ModelChoice;
  readonly toolChoice: "auto" | "none";
}

export interface LoopHooks {
  onModelCall?(
    info: ModelCallInfo,
    next: () => Promise<StreamTurnResult>,
  ): Promise<StreamTurnResult>;
  beforeToolCall?(
    call: { name: string; args: unknown; },
  ): Promise<"allow" | "block" | "require_approval">;
  onToolCall?(
    call: { name: string; args: unknown; },
    next: () => Promise<string>,
  ): Promise<string>;
}

export interface ToolSample {
  readonly componentId: string;
  readonly toolMs: number;
  readonly outputBytes: number;
  readonly error: boolean;
}

/** A read-only per-round digest for the forked observer (§13). Content-bounded. */
export interface RoundDigest {
  readonly round: number;
  readonly assistantText: string;
  readonly tools: { name: string; resultPreview: string; }[];
}

export interface RunAgentDeps {
  readonly llm: LlmPort;
  readonly obs: Observability;
  readonly hooks?: LoopHooks;
  /** Estimate USD cost of a call (§11); default 0. */
  estimateCost?(model: ModelChoice, usage: Usage): number;
  /** Per-tool dynamic footprint sink (§11.1); the runtime maps it to the ledger. */
  recordTool?(sample: ToolSample): void;
  /** Forked, silence-biased observer (§13). Fire-and-forget; may push steering. */
  observeRound?(digest: RoundDigest): void;
  /** Effect-native observer path used by the managed runtime. */
  observeRoundEffect?(digest: RoundDigest): Effect.Effect<void>;
}

export interface RunAgentParams {
  readonly system: string;
  readonly messages: ChatMessage[];
  /** Exposed toolset (§10.1) — includes search_tools/invoke_tool meta-tools. */
  readonly tools: Map<string, ToolDef>;
  readonly model: ModelChoice;
  readonly maxRounds: number;
  readonly ctx: ToolCtx;
  readonly steering: SteeringChannel;
  readonly budget: BudgetAccumulator;
  readonly signal: AbortSignal;
}

export interface RunAgentResult {
  readonly text: string;
  readonly usage: Usage;
  readonly rounds: number;
  readonly roundsExhausted: boolean;
  readonly toolCalls: number;
}
