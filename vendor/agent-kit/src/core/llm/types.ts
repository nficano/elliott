import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import type { LlmError } from "../errors.js";
import type { ChatMessage, ModelChoice, Usage } from "../types.js";
import type {
  ChatChunkSchema,
  ChatCompletionSchema,
  EmbedResponseSchema,
  RawUsageSchema,
  WireToolCallRespSchema,
} from "./schema.js";

export {
  ChatChunkSchema,
  ChatCompletionSchema,
  EmbedResponseSchema,
  RawUsageSchema,
  WireToolCallRespSchema,
} from "./schema.js";

/** A model-facing tool schema (OpenAI-compatible "function" shape). */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /** JSON Schema derived from the Effect Schema decoder (§7.2). */
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string; // raw JSON string as emitted by the model
}

export interface TurnRequest {
  readonly model: ModelChoice;
  /** Stable prefix first (tools → system → messages), for cache correctness (§10.1). */
  readonly system: string;
  readonly messages: ChatMessage[];
  readonly tools: ToolSchema[];
  /** auto (default), none (final wrap-up round), or force a specific tool (§10.3). */
  readonly toolChoice?: "auto" | "none" | { name: string; };
  /** Mark the cache breakpoint after tools+system+persona (§10.2). */
  readonly cacheBreakpoint?: boolean;
  readonly signal?: AbortSignal;
}

export interface StreamTurnResult {
  readonly text: string;
  readonly toolCalls: ToolCall[];
  readonly finishReason:
    | "stop"
    | "tool_calls"
    | "length"
    | "content_filter"
    | "error";
  readonly responseModel: string;
  readonly usage: Usage;
  readonly ttftMs: number;
  readonly totalMs: number;
}

export interface EmbedRequest {
  readonly input: string | string[];
  /** Overrides `llm.models.embed`; used by memory dual-write/reindex (§7.4). */
  readonly model?: string;
}

export interface EmbedResult {
  readonly vectors: number[][];
  readonly model: string;
  readonly dim: number;
}

/**
 * LLM gateway (§7.1). Raw fetch to the LiteLLM OpenAI-compatible endpoint; no
 * vendor SDK. Per-key concurrency semaphore + transient retry live inside.
 */
export interface LlmPort {
  streamTurn(req: TurnRequest): Effect.Effect<StreamTurnResult, LlmError>;
  /** Non-streaming completion (used for utility-tier meta-calls, §9). */
  complete(req: TurnRequest): Effect.Effect<StreamTurnResult, LlmError>;
  embed(req: EmbedRequest): Effect.Effect<EmbedResult, LlmError>;
}

export interface GatewayConfig {
  readonly baseUrl: string;
  readonly apiKey: Redacted.Redacted<string>;
  readonly maxParallel: number;
  readonly promptCache: boolean;
  readonly embedModel: string;
  readonly maxRetries?: number;
}

export type RawUsage = typeof RawUsageSchema.Type;

// ── OpenAI-compatible wire shapes (wire.ts) ──

export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string; };
}

export type WireToolCallResp = typeof WireToolCallRespSchema.Type;

export type ChatCompletion = typeof ChatCompletionSchema.Type;

export type ChatChunk = typeof ChatChunkSchema.Type;

export type EmbedResponse = typeof EmbedResponseSchema.Type;
