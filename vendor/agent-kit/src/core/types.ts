/**
 * Cross-cutting primitives referenced across the codebase. Naming per §26:
 * tier/profile/trust/origin are lowercase closed enums, never new names.
 */
import type {
  BudgetExceeded,
  ChannelError,
  ConfigError,
  LlmError,
  McpError,
  MemoryError,
  StoreError,
  ToolError,
} from "./errors.js";

/** COST/CAPABILITY tier (§6, §9). `utility` = the runtime's own meta-calls. */
export type Tier = "utility" | "trivial" | "fast" | "standard" | "deep";
export const TIERS: readonly Tier[] = [
  "utility",
  "trivial",
  "fast",
  "standard",
  "deep",
];

/** TASK SHAPE, orthogonal to tier (§6, §9). */
export interface Profile {
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Pin a model if the tier default won't do (§9 strict-for-explicit). */
  readonly preferredModel?: string;
}

/** Memory/provenance trust of a piece of content (§7.4, §16). Min-trust wins. */
export type Origin = "owner" | "internal" | "untrusted";
export const ORIGINS: readonly Origin[] = ["owner", "internal", "untrusted"];

/** Rank so the "minimum trust of any source" rule (§7.4) is a numeric min. */
export const ORIGIN_RANK: Record<Origin, number> = {
  owner: 3,
  internal: 2,
  untrusted: 1,
};
export function minOrigin(a: Origin, b: Origin): Origin {
  return ORIGIN_RANK[a] <= ORIGIN_RANK[b] ? a : b;
}

/** A registrable's boundary role (§16). */
export type Trust = "read" | "write" | "internal";

/** LiteLLM usage, normalized across providers (§27.5). */
export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}

// ── Chat message shape (provider-agnostic; maps to OpenAI-compatible wire) ──

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}
export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: Role;
  /** String for simple turns; blocks for tool-use/tool-result turns (§10.4 pairing). */
  readonly content: string | ContentBlock[];
  /** Present on tool-role messages (OpenAI wire); mirrors a ToolResultBlock. */
  readonly tool_call_id?: string;
  /** Provenance for trust-aware compaction/memory (§7.4). */
  readonly origin?: Origin;
}

/** Resolved model + decode params for one call (§9). */
export interface ModelChoice {
  readonly model: string;
  readonly tier: Tier;
  readonly maxTokens: number;
  readonly temperature: number;
  /** false = an explicit pin that must resolve exactly or fail loudly (§9). */
  readonly allowFallback: boolean;
}

/** Injected clock — Postgres `now()` is authority for leases/fires (§20); this is
 *  for app-level timestamps only, and is a seam so tests are deterministic. */
export interface Clock {
  now(): Date;
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

// ── error taxonomy tags/unions (errors.ts) — the classes themselves stay there ──

export type ErrorTag =
  | "ConfigError"
  | "StoreError"
  | "LlmError"
  | "ToolError"
  | "McpError"
  | "ChannelError"
  | "BudgetExceeded"
  | "MemoryError"
  // Defined in their own modules: the capability bus + integrations HTTP core
  // carry the taxonomy one level further.
  | "CapabilityError"
  | "IntegrationError";

export type AnyError =
  | ConfigError
  | StoreError
  | LlmError
  | ToolError
  | McpError
  | ChannelError
  | BudgetExceeded
  | MemoryError;

// ── supervised-subsystem lifecycle (lifecycle.ts) ──

export type HealthState = "ok" | "degraded" | "down";

export interface Health {
  readonly state: HealthState;
  readonly detail?: string;
}

export interface Lifecycle {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<Health>;
}

// ── anchored edits + path fencing (edits.ts) ──

export interface AnchoredEdit {
  /** Exact text that must occur exactly once in the current content. */
  readonly find: string;
  readonly replace: string;
}

export type EditFailure =
  | { readonly kind: "absent"; readonly index: number; }
  | {
    readonly kind: "ambiguous";
    readonly index: number;
    readonly count: number;
  };

export type EditResult =
  | { readonly ok: true; readonly content: string; }
  | { readonly ok: false; readonly failure: EditFailure; };
