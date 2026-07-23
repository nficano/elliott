import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
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
  NotifySvc,
  ObsSvc,
  RegistrySvc,
  RouterSvc,
  SchedulerSvc,
  StoreSvc,
} from "../../core/di/services.js";
import { systemClock } from "../../core/types.js";
import { proposalsToMarkdown } from "../../plugins/self-improve/reflection.js";
import { registerDelegateHandler } from "../jobs/delegate.js";
import { registerReminderHandler } from "../jobs/reminder.js";
import { RuntimeEnvSvc } from "../runtime/env.js";
import type { RuntimeApi } from "../runtime/types.js";
import { registerScheduleHandlers } from "../scheduler/run.js";
import type {
  Infrastructure,
  InteractionLayer,
  ServiceLayer,
} from "./types.js";
import type { AgentKitOptions, AppServices } from "./types.js";

export function assembleAppLayer(
  infra: Infrastructure,
  services: ServiceLayer,
  interactions: InteractionLayer,
): Layer.Layer<AppServices> {
  const infrastructureLayer = Layer.mergeAll(
    Layer.succeed(ConfigSvc)(infra.config),
    Layer.succeed(ClockSvc)(systemClock),
    Layer.succeed(StoreSvc)(infra.store),
    Layer.succeed(ObsSvc)(infra.obs),
    Layer.succeed(ErrorReporterSvc)(infra.reporter),
    Layer.succeed(LlmSvc)(infra.llm),
    Layer.succeed(MemorySvc)(infra.memory),
    Layer.succeed(FootprintSvc)(infra.footprint),
  );
  const serviceLayer = Layer.mergeAll(
    Layer.succeed(RegistrySvc)(services.registry),
    Layer.succeed(CapabilitiesSvc)(services.caps),
    Layer.succeed(RouterSvc)(services.router),
    Layer.succeed(JobsSvc)(services.jobs),
  );
  const interactionLayer = Layer.mergeAll(
    Layer.succeed(SchedulerSvc)(interactions.scheduler),
    Layer.succeed(ApprovalSvc)(interactions.approvalGate),
    Layer.succeed(ApprovalDeliverSvc)(interactions.deliverApproval),
    Layer.succeed(RuntimeEnvSvc)(interactions.runtimeEnv),
  );
  const notifyLayer = infra.notify === undefined
    ? Layer.empty
    : Layer.succeed(NotifySvc)(infra.notify);
  return Layer.mergeAll(
    infrastructureLayer,
    serviceLayer,
    interactionLayer,
    notifyLayer,
    infra.obsLayer,
  );
}

export function configureJobHandlers(options: {
  readonly opts: AgentKitOptions;
  readonly infra: Infrastructure;
  readonly services: ServiceLayer;
  readonly interactions: InteractionLayer;
  readonly runtime: RuntimeApi;
}): void {
  const { opts, infra, services, interactions, runtime } = options;
  registerDelegateHandler(services.jobs, runtime, interactions.deliver);
  // Reminder delivery (§17) — eager so a reminder due right after a restart
  // finds its handler even though the reminders skill activates lazily.
  registerReminderHandler(services.jobs, infra.notify);
  const schedules = opts.schedules ?? [];
  registerScheduleHandlers({
    jobs: services.jobs,
    runtime,
    notify: infra.notify,
    schedules,
    reporter: infra.reporter,
  });
  services.jobs.handle("sched:reflect", async () => {
    const proposals = await interactions.reflection.reflect();
    if (infra.notify && proposals.length > 0) {
      await Effect.runPromise(
        Effect.ignore(
          infra.notify.send({
            subject: "Nightly reflection proposals",
            body: proposalsToMarkdown(proposals),
          }),
        ),
      );
    }
  });
  for (const schedule of schedules) interactions.scheduler.register(schedule);
}
