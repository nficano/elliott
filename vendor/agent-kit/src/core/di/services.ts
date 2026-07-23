import * as Context from "effect/Context";
import type { CapabilityInvoker } from "../../host/capabilities/types.js";
import type { ConfigStore } from "../../host/config/store.js";
import type { FootprintLedger } from "../../host/footprint/types.js";
import type { JobQueue } from "../../host/jobs/types.js";
import type {
  ErrorReporter,
  Observability,
} from "../../host/observability/types.js";
import type { Registry } from "../../host/registry/types.js";
import type { Router } from "../../host/router/types.js";
import type { Scheduler } from "../../host/scheduler/types.js";
import type { ApprovalGate } from "../../plugins/trust/approval-gate.js";
import type { StorePort } from "../../store/types.js";
import type { LlmPort } from "../llm/types.js";
import type { MemoryPort } from "../memory/types.js";
import type { NotifyPort } from "../notify/types.js";
import type { Clock } from "../types.js";

/**
 * Effect DI (§4, Phase B) — each process-lifetime dependency is a `Context.Service`
 * service, replacing the hand-rolled container. Host programs access a service
 * with `yield* Svc` inside `Effect.gen`; `bootstrap` provides them as `Layer`s
 * and launches the supervisor as one Effect. The service class name is the
 * context key; its second type param is the service shape.
 */

export class ConfigSvc
  extends Context.Service<ConfigSvc, ConfigStore>()("Config")
{}
export class ClockSvc extends Context.Service<ClockSvc, Clock>()("Clock") {}
export class StoreSvc extends Context.Service<StoreSvc, StorePort>()("Store") {}
export class ObsSvc
  extends Context.Service<ObsSvc, Observability>()("Observability")
{}
/** GlitchTip exception reporting (§12) — noop when unconfigured. */
export class ErrorReporterSvc
  extends Context.Service<ErrorReporterSvc, ErrorReporter>()("ErrorReporter")
{}
export class LlmSvc extends Context.Service<LlmSvc, LlmPort>()("Llm") {}
export class MemorySvc
  extends Context.Service<MemorySvc, MemoryPort>()("Memory")
{}
export class NotifySvc
  extends Context.Service<NotifySvc, NotifyPort>()("Notify")
{}
export class RegistrySvc
  extends Context.Service<RegistrySvc, Registry>()("Registry")
{}
export class CapabilitiesSvc
  extends Context.Service<CapabilitiesSvc, CapabilityInvoker>()("Capabilities")
{}
export class RouterSvc extends Context.Service<RouterSvc, Router>()("Router") {}
export class FootprintSvc
  extends Context.Service<FootprintSvc, FootprintLedger>()("Footprint")
{}
export class JobsSvc extends Context.Service<JobsSvc, JobQueue>()("Jobs") {}
export class SchedulerSvc
  extends Context.Service<SchedulerSvc, Scheduler>()("Scheduler")
{}
export class ApprovalSvc
  extends Context.Service<ApprovalSvc, ApprovalGate>()("Approval")
{}
/** The owner-facing approval delivery callback (§16). */
export class ApprovalDeliverSvc extends Context.Service<
  ApprovalDeliverSvc,
  (text: string) => Promise<void>
>()("ApprovalDeliver") {}

export type { ServiceGet } from "./types.js";
