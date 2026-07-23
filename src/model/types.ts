// Provider-neutral model protocol and orthogonal routing — TDD §4, §5.

import type { Digest } from "../core/types";

export type ModelCapability =
  | "text"
  | "vision"
  | "audio-input"
  | "tool-calling"
  | "parallel-tool-calling"
  | "structured-output"
  | "reasoning"
  | "prompt-caching"
  | "long-context";

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

/** Reserved profiles order capability/cost only, never latency (§5a). Custom
 *  profiles are namespaced so a typo cannot mint a reserved-looking one. */
export type ReservedProfile = "fast" | "balanced" | "deep";
export type ModelProfileId = ReservedProfile | `custom:${string}`;

export interface ModelCatalogEntry {
  readonly modelId: string;
  readonly capabilities: readonly ModelCapability[];
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /** Unknown cost is treated as +Infinity by the resolver (§5d), never zero. */
  readonly costPerThousandInputTokensUsd?: number;
  readonly costPerThousandOutputTokensUsd?: number;
  /** Display/cross-check only. Enforcement uses the kernel ResidencyGrant. */
  readonly declaredLocality: "local" | "private-cloud" | "public-cloud";
  readonly available: boolean;
  readonly catalogDigest: Digest;
}

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelStreamEvent {
  readonly type: "text" | "tool-call" | "usage" | "done" | "error";
  readonly payload: unknown;
}

export interface EmbeddingRequest {
  readonly modelId: string;
  readonly inputs: readonly string[];
}

export interface EmbeddingResponse {
  readonly embeddings: readonly (readonly number[])[];
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly detail?: string;
}

export interface ModelGenerateRequest {
  readonly invocation: string;
  readonly modelId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  readonly reasoningEffort?: "none" | "low" | "medium" | "high";
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ModelProviderProtocol {
  catalog(): Promise<readonly ModelCatalogEntry[]>;
  generate(request: ModelGenerateRequest): AsyncIterable<ModelStreamEvent>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  health(): Promise<HealthStatus>;
}

/** A task expresses intent across the three orthogonal axes (§5b). */
export interface ModelTask {
  readonly profile: ReservedProfile;
  /** Advisory floor only. The kernel dispatches at
   *  max(declared, frame high-water mark); see §5d step 2. */
  readonly declaredClassification: DataClassification;
  readonly operation: "chat" | "embedding" | "speech-to-text";
  readonly requires: readonly ModelCapability[];
  readonly maxCostUsd?: number;
}

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
  readonly priority: number;
  readonly costMetric: number;
}

/** Pre-filtered, pre-sorted candidates keyed by
 *  (profile, effective classification, required-capability set) — §5d. */
export interface RouteTableEntry {
  readonly candidates: readonly ModelRoute[];
  readonly builtFromDigests: readonly Digest[];
}

export interface ModelSelectionRecord {
  readonly task: ModelTask;
  readonly effectiveClassification: DataClassification;
  readonly selected?: ModelRoute;
  readonly tableVersion: string;
}
