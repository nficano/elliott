import type { LlmPort } from "../../core/llm/types.js";
import type { ModelChoice, Origin } from "../../core/types.js";
import type { EnvelopeSchema } from "./envelope-schema.js";

export type Envelope = typeof EnvelopeSchema.Type;

export interface ApprovalVariant {
  readonly label: string;
  readonly args: unknown;
}

export interface StagedAction {
  readonly nonce: string;
  readonly payloadHash: string;
  readonly tool: string;
  readonly summary: string;
  readonly expiresAt: number;
  readonly variants?: readonly ApprovalVariant[];
  readonly run: (chosenArgs?: unknown) => Promise<string>;
}

export interface ApprovalPrompt {
  readonly nonce: string;
  readonly payloadHash: string;
  readonly text: string;
}

export type ScreenDecision = "pass" | "flag" | "block";

export interface ScreenResult {
  readonly origin: Origin;
  readonly decision: ScreenDecision;
  readonly risk: "none" | "low" | "medium" | "high";
  readonly reason?: string;
}

export interface InjectionScreenConfig {
  readonly llm?: LlmPort;
  readonly utilityModel?: ModelChoice;
  readonly layer2?: boolean;
}
