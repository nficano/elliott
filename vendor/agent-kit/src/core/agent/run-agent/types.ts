import type { ToolCall, ToolSchema } from "../../llm/types.js";
import type { ChatMessage, Usage } from "../../types.js";
import type { RunAgentDeps, RunAgentParams, ToolDef } from "../types.js";

export interface AgentLoopState {
  messages: ChatMessage[];
  totalUsage: Usage;
  toolCallCount: number;
  finalText: string;
  isPendingToolIntent: boolean;
  isRoundsExhausted: boolean;
  round: number;
}

export interface LoopOptions {
  readonly deps: RunAgentDeps;
  readonly params: RunAgentParams;
  readonly schemas: ToolSchema[];
  readonly state: AgentLoopState;
}

export interface ModelCallOptions extends LoopOptions {
  readonly toolChoice: "auto" | "none";
}

export interface ToolExecution {
  readonly deps: RunAgentDeps;
  readonly params: RunAgentParams;
  readonly call: ToolCall;
}

export interface AllowedToolExecution extends ToolExecution {
  readonly definition: ToolDef;
  readonly args: unknown;
}
