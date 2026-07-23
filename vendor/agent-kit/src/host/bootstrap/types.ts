import type * as Layer from "effect/Layer";
import type { LoopHooks, ToolDef } from "../../core/agent/types.js";
import type { Channel } from "../../core/channels/types.js";
import type {
  ApprovalDeliverSvc,
  ApprovalSvc,
  CapabilitiesSvc,
  ClockSvc,
  ConfigSvc,
  ErrorReporterSvc,
  FootprintSvc,
  JobsSvc,
  LlmSvc,
  MemorySvc,
  ObsSvc,
  RegistrySvc,
  RouterSvc,
  SchedulerSvc,
  ServiceGet,
  StoreSvc,
} from "../../core/di/services.js";
import type { LiteLlmGateway } from "../../core/llm/gateway.js";
import type { PgMemory } from "../../core/memory/memory.js";
import type { Lifecycle } from "../../core/types.js";
import type { Reflection } from "../../plugins/self-improve/reflection.js";
import type { ApprovalGate } from "../../plugins/trust/approval-gate.js";
import type { StoreSubsystem } from "../../store/lifecycle.js";
import type { StorePort } from "../../store/types.js";
import type { ContractCatalog } from "../capabilities/contracts.js";
import type { CapabilityInvoker } from "../capabilities/types.js";
import type { AgentKitConfig } from "../config/schema.js";
import type { ConfigStore } from "../config/store.js";
import type { SecretResolver } from "../config/types.js";
import type { PgFootprintLedger } from "../footprint/ledger.js";
import type { PgJobQueue } from "../jobs/queue.js";
import type { WebhookNotify } from "../notify/webhook.js";
import type { ErrorReporter, Observability } from "../observability/types.js";
import type { Registrable, ScheduleSpec } from "../registry/types.js";
import type { Registry } from "../registry/types.js";
import type { Router } from "../router/types.js";
import type { RuntimeEnvSvc } from "../runtime/env.js";
import type { AgentSpec, RuntimeApi, RuntimeEnv } from "../runtime/types.js";
import type { PgScheduler } from "../scheduler/scheduler.js";

export interface AgentKitOptions {
  readonly configDir: string;
  readonly env: string;
  readonly appName?: string;
  readonly resolver?: SecretResolver;
  /**
   * Config fragment deep-merged over the configDir layers before schema decode
   * (the agent-spec compiler's `skills.<id>`/`mcp.<id>` enablement blocks —
   * AGENT-SPEC §1.3; spec enablement wins).
   */
  readonly configOverlay?: Record<string, unknown>;
  readonly registrables?: Registrable[];
  readonly contracts?: (catalog: ContractCatalog) => void;
  readonly agents: AgentSpec[];
  readonly schedules?: ScheduleSpec[];
  readonly bundleDescriptions?: Record<string, string>;
  readonly hooks?: LoopHooks;
  readonly extraCoreTools?: (get: ServiceGet) => ToolDef[];
}

export interface AgentKit {
  readonly get: ServiceGet;
  readonly runtime: RuntimeApi;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface Infrastructure {
  readonly config: ConfigStore;
  readonly cfg: AgentKitConfig;
  readonly obs: Observability;
  /** GlitchTip exception reporting (§12) — noop when unconfigured. */
  readonly reporter: ErrorReporter;
  readonly obsLayer: Layer.Layer<never>;
  readonly obsLifecycle: Lifecycle;
  readonly storeSubsystem: StoreSubsystem;
  readonly store: StorePort;
  readonly llm: LiteLlmGateway;
  readonly footprint: PgFootprintLedger;
  readonly memory: PgMemory;
  readonly notify: WebhookNotify | undefined;
}

export interface ServiceLayer {
  readonly catalog: ContractCatalog;
  readonly registry: Registry;
  readonly caps: CapabilityInvoker;
  readonly jobs: PgJobQueue;
  readonly router: Router;
}

export interface InteractionLayer {
  readonly channels: Channel[];
  readonly deliver: (conversationKey: string, text: string) => Promise<void>;
  readonly reflection: Reflection;
  readonly approvalGate: ApprovalGate;
  readonly deliverApproval: (text: string) => Promise<void>;
  readonly scheduler: PgScheduler;
  readonly runtimeEnv: RuntimeEnv;
}

export type AppServices =
  | ConfigSvc
  | ClockSvc
  | StoreSvc
  | ObsSvc
  | ErrorReporterSvc
  | LlmSvc
  | MemorySvc
  | RegistrySvc
  | CapabilitiesSvc
  | RouterSvc
  | FootprintSvc
  | JobsSvc
  | SchedulerSvc
  | ApprovalSvc
  | ApprovalDeliverSvc
  | RuntimeEnvSvc;
