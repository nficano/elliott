import type { LoopHooks } from "../../core/agent/types.js";
import type { Inbound } from "../../core/channels/types.js";
import type {
  ConfigSvc,
  ErrorReporterSvc,
  FootprintSvc,
  LlmSvc,
  MemorySvc,
  ObsSvc,
  RegistrySvc,
  RouterSvc,
} from "../../core/di/services.js";
import type {
  ChatMessage,
  Origin,
  Profile,
  Tier,
  Trust,
  Usage,
} from "../../core/types.js";
import type { Observer } from "../../plugins/self-improve/observer.js";
import type { InjectionScreen } from "../../plugins/trust/injection-screen.js";
import type { AgentKitConfig } from "../config/schema.js";
import type { HistoryRepo } from "../history/history.js";
import type { RuntimeEnvSvc } from "./env.js";

/**
 * A turn's request-scoped context (§4). Holds trace/session ids, the config
 * snapshot taken at turn start (§5 hot-reload safety), the selected bundles, a
 * budget accumulator, and a steering channel (§7.3).
 */
export interface TurnCtx {
  readonly traceId: string;
  readonly sessionId: string;
  readonly conversationKey: string;
  /** Config snapshot captured at child-scope creation — immutable for this turn. */
  readonly config: AgentKitConfig;
  /** Which agent identity is running (§17). */
  readonly agentId: string;
  readonly origin: Origin;
  readonly tier: Tier;
  readonly profile: Profile;
  /** Bundles selected by the router for this turn (§10.1). */
  bundles: string[];
  readonly budget: BudgetAccumulator;
  readonly steering: SteeringChannel;
  readonly signal: AbortSignal;
}

export interface TurnInput {
  readonly conversationKey: string;
  readonly agentId: string;
  readonly text: string;
  readonly origin: Origin;
  /** Prior history (from store or in-request) — head+tail protected on compaction. */
  readonly history?: ChatMessage[];
  /** Per-turn tier override (a ScheduleSpec's tier beats the agent's default). */
  readonly tier?: Tier;
}

export interface TurnResult {
  readonly text: string;
  readonly usage: Usage;
  readonly rounds: number;
  readonly roundsExhausted: boolean;
  readonly toolCalls: number;
  readonly costUsd: number;
  readonly traceId: string;
  readonly error?: string;
}

/** Per-turn budget guard (§11). Throws BudgetExceeded on breach. */
export interface BudgetAccumulator {
  addUsage(u: Usage, costUsd: number): void;
  readonly spentUsd: number;
  readonly perTurnCapUsd: number;
  assertWithinCap(): void;
}

/**
 * Steering (§7.3): a bounded FIFO per turn (cap ~8; overflow drops oldest with a
 * metric). Drain-all at round boundaries only; never mid-round. Steering is
 * appended AFTER the complete tool-result block (tool-pair invariant, §10.4).
 */
export interface SteeringChannel {
  push(text: string): void;
  drain(): string[];
  readonly dropped: number;
}

/**
 * The fleet's dispatch identities (§17). Agents are orchestration identities
 * (persona + trust + tier), distinct from tool-contributing skills/MCPs in the
 * registry. The consumer (agent-oslo) supplies these — persona text is a git
 * asset there, never in agent-kit (§24).
 */
export interface AgentSpec {
  readonly id: string;
  /** System prompt / persona (a git asset in the consumer, §12.2). */
  readonly persona: string;
  readonly tier: Tier;
  readonly maxRounds: number;
  readonly trust: Trust;
  readonly profile?: string;
  /** Pin specific bundles; if absent, the router selects per turn (§10.1). */
  readonly bundles?: string[];
}

export interface AgentDirectory {
  resolve(id: string): AgentSpec | undefined;
  readonly defaultAgentId: string;
}

/**
 * Per-kit runtime collaborators (§4/§15). The infrastructure singletons (llm,
 * router, registry, obs, memory, footprint, config, notify, approval) are their
 * own `Context.Service` keys, provided by the application `Layer` and shared by
 * one `ManagedRuntime`. This bundles the runtime-shaped bindings the turn loop
 * needs — the agent directory, history repo, channel delivery, the ingress
 * screen/observer, loop hooks, inbound dedupe, and the in-flight guard — into a
 * single service so `runTurn`/`handleInbound` reach them via
 * `yield* RuntimeEnvSvc` rather than constructor injection. Optional members
 * mirror the old `RuntimeDeps` optionality
 * (screen/observer/hooks/seenBefore may be absent).
 */
export interface RuntimeEnv {
  readonly agents: AgentDirectory;
  readonly history: HistoryRepo;
  /** Channel delivery — the composition maps a conversationKey to the right adapter. */
  readonly deliver: (conversationKey: string, text: string) => Promise<void>;
  readonly injectionScreen?: InjectionScreen;
  readonly observer?: Observer;
  readonly hooks?: LoopHooks;
  /** Dedupe an inbound (Telegram update_id / iMessage GUID); true if already seen (§14). */
  readonly seenBefore?: (
    channel: string,
    externalId: string,
  ) => Promise<boolean>;
  /** Per-conversation in-flight guard (§20 interactive flood) — process-lifetime state. */
  readonly inflight: Set<string>;
}

export interface BuildTurnCtxParams {
  readonly traceId: string;
  readonly conversationKey: string;
  readonly config: AgentKitConfig;
  readonly agentId: string;
  readonly origin: Origin;
  readonly tier: Tier;
  readonly profile: Profile;
  readonly budget: BudgetAccumulator;
  readonly steering: SteeringChannel;
  readonly signal: AbortSignal;
}

/** Services the turn programs pull from the app `Context`. */
export type RuntimeServices =
  | ConfigSvc
  | ObsSvc
  | ErrorReporterSvc
  | LlmSvc
  | RouterSvc
  | RegistrySvc
  | FootprintSvc
  | MemorySvc
  | RuntimeEnvSvc;

/** The turn API exposed to channels, http ingress, jobs, and schedules. */
export interface RuntimeApi {
  handleInbound(msg: Inbound): Promise<void>;
  runTurn(input: TurnInput): Promise<TurnResult>;
}
