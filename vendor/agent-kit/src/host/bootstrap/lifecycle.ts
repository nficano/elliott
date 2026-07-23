import * as Effect from "effect/Effect";
import type { Inbound } from "../../core/channels/types.js";
import type { Health, Lifecycle } from "../../core/types.js";
import { makeApp } from "../app.js";
import type { AppRunner } from "../app/types.js";
import { HttpServer } from "../http/server.js";
import type { RuntimeApi } from "../runtime/types.js";
import type {
  Infrastructure,
  InteractionLayer,
  ServiceLayer,
} from "./types.js";

const APP_DRAIN_TIMEOUT_MS = 10_000;

export function buildSupervisedApp(options: {
  readonly infra: Infrastructure;
  readonly services: ServiceLayer;
  readonly interactions: InteractionLayer;
  readonly runtime: RuntimeApi;
}): AppRunner {
  const { infra, services, interactions, runtime } = options;
  const appHolder: { current?: AppRunner; } = {};
  const http = new HttpServer({
    port: infra.cfg.runtime.http.port,
    controlToken: infra.cfg.runtime.control_token,
    handlers: {
      health: () => Effect.runPromise(appHolder.current!.health),
      ready: () => Effect.runPromise(appHolder.current!.health),
      reloadConfig: async () => {
        const result = await infra.config.reload();
        services.router.invalidateCatalog();
        return result;
      },
      footprint: () => infra.footprint.report(),
      jobsStatus: async () => ({ depth: await services.jobs.depth() }),
      trigger: async (id, payload) => {
        const jobId = await services.jobs.enqueue({
          kind: id,
          payload: (payload as Record<string, unknown>) ?? {},
        });
        return {
          ok: Boolean(jobId),
          detail: jobId ? `enqueued job ${jobId}` : "deduped",
        };
      },
      ingress: (message) => runtime.handleInbound(message),
    },
  });
  const app = makeApp(
    buildLifecycles({ infra, services, interactions, runtime, http }),
    { drainMs: APP_DRAIN_TIMEOUT_MS },
  );
  appHolder.current = app;
  return app;
}

function buildLifecycles(options: {
  readonly infra: Infrastructure;
  readonly services: ServiceLayer;
  readonly interactions: InteractionLayer;
  readonly runtime: RuntimeApi;
  readonly http: HttpServer;
}): Lifecycle[] {
  const { infra, services, interactions, runtime, http } = options;
  return [
    infra.obsLifecycle,
    infra.storeSubsystem,
    healthyLifecycle(
      "footprint",
      async () => infra.footprint.start(),
      () => infra.footprint.stop(),
    ),
    channelLifecycle(interactions, runtime),
    healthyLifecycle(
      "scheduler",
      () => interactions.scheduler.start(),
      () => interactions.scheduler.stop(),
    ),
    healthyLifecycle(
      "jobs",
      () => services.jobs.start(),
      () => services.jobs.stop(),
    ),
    http,
  ];
}

function healthyLifecycle(
  name: string,
  start: () => Promise<void>,
  stop: () => Promise<void>,
): Lifecycle {
  return {
    name,
    start,
    stop,
    async health(): Promise<Health> {
      return { state: "ok" };
    },
  };
}

function channelLifecycle(
  interactions: InteractionLayer,
  runtime: RuntimeApi,
): Lifecycle {
  return {
    name: "channels",
    async start() {
      for (const channel of interactions.channels) {
        await channel.listen((message: Inbound) =>
          runtime.handleInbound(message)
        );
      }
    },
    async stop() {
      for (const channel of interactions.channels) await channel.stop();
    },
    async health(): Promise<Health> {
      const states = await Promise.all(
        interactions.channels.map((channel) => channel.health()),
      );
      return states.some((health) => health.state === "down")
        ? { state: "degraded", detail: "a channel is down" }
        : { state: "ok" };
    },
  };
}
