import type { BoundedSteering } from "../../../core/agent/steering.js";
import type {
  RunAgentDeps,
  ToolCtx,
  ToolDef,
} from "../../../core/agent/types.js";
import type { LlmPort } from "../../../core/llm/types.js";
import type { MemoryPort, MemoryRecord } from "../../../core/memory/types.js";
import type { ChatMessage, ModelChoice, Tier } from "../../../core/types.js";
import type { Observer } from "../../../plugins/self-improve/observer.js";
import type { AgentKitConfig } from "../../config/schema.js";
import type { FootprintLedger } from "../../footprint/types.js";
import type { HistoryRepo } from "../../history/history.js";
import type { Observability } from "../../observability/types.js";
import type { Registry } from "../../registry/types.js";
import type { Router } from "../../router/types.js";
import type { TurnBudget } from "../budget.js";
import type {
  AgentSpec,
  RuntimeEnv,
  SteeringChannel,
  TurnInput,
} from "../types.js";

export interface TurnExecution {
  readonly input: TurnInput;
  readonly env: RuntimeEnv;
  readonly obs: Observability;
  readonly llm: LlmPort;
  readonly router: Router;
  readonly registry: Registry;
  readonly footprint: FootprintLedger;
  readonly memory: MemoryPort;
  readonly config: AgentKitConfig;
  readonly agent: AgentSpec;
}

export interface TurnSession extends TurnExecution {
  readonly abort: AbortController;
  readonly budget: TurnBudget;
  readonly steering: BoundedSteering;
  readonly tier: Tier;
  readonly model: ModelChoice;
}

export interface PreparedRun {
  readonly context: ToolCtx;
  readonly system: string;
  readonly messages: ChatMessage[];
  readonly tools: Map<string, ToolDef>;
  readonly observerState: ObserverState;
  readonly observeRoundEffect: RunAgentDeps["observeRoundEffect"];
}

export interface SystemPromptParts {
  readonly persona: string;
  readonly facts: MemoryRecord[];
  readonly fragments: string[];
  readonly timezone: string;
}

export interface ObserverState {
  isTurnActive: boolean;
}

export interface ObserveRoundOptions {
  readonly observer: Observer | undefined;
  readonly memory: MemoryPort;
  readonly steering: SteeringChannel;
  readonly state: ObserverState;
}

export interface PersistTurnOptions {
  readonly history: HistoryRepo;
  readonly memory: MemoryPort;
  readonly input: TurnInput;
  readonly replyText: string;
}

export interface AgentDepsOptions {
  readonly llm: LlmPort;
  readonly obs: Observability;
  readonly footprint: FootprintLedger;
  readonly env: RuntimeEnv;
  readonly observeRoundEffect: RunAgentDeps["observeRoundEffect"];
}
