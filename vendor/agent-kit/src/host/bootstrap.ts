import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { ServiceGet } from "../core/di/services.js";
import { installProcessErrorHandlers, installSignalHandlers } from "./app.js";
import { assembleAppLayer, configureJobHandlers } from "./bootstrap/context.js";
import { bootInfrastructure, buildServiceLayer } from "./bootstrap/core.js";
import { buildInteractionLayer } from "./bootstrap/interactions.js";
import { buildSupervisedApp } from "./bootstrap/lifecycle.js";
import type {
  AgentKit,
  AgentKitOptions,
  AppServices,
} from "./bootstrap/types.js";
import { makeRuntimeApi } from "./runtime/runtime.js";

export type { AgentKit, AgentKitOptions } from "./bootstrap/types.js";

const SHUTDOWN_REPORTER_FLUSH_MS = 2000;

export const DEFAULT_BUNDLE_ORDER = [
  "web",
  "comms",
  "home",
  "security",
  "memory",
  "ops",
];

const DEFAULT_BUNDLE_DESCRIPTIONS: Record<string, string> = {
  web: "web search, scraping, browser automation, fetching pages",
  comms: "messaging, email, notifications, sending alerts to the owner",
  home: "home assistant, smart home, locks, lights, climate, sensors",
  security: "cameras, motion, network alerts, security events, vision",
  memory: "recall and store durable facts and learnings",
  ops: "scheduling, jobs, background tasks, system operations",
};

/**
 * Composition root. Boots process-lifetime services, assembles the Effect
 * application Layer and ManagedRuntime, then wires supervised lifecycle ordering.
 */
export async function createAgentKit(opts: AgentKitOptions): Promise<AgentKit> {
  const contextHolder: { current?: Context.Context<AppServices>; } = {};
  const get = makeServiceGet(contextHolder);
  const infra = await bootInfrastructure(opts);
  const services = buildServiceLayer({
    opts,
    infra,
    get,
    bundleDescriptions: DEFAULT_BUNDLE_DESCRIPTIONS,
    bundleOrder: DEFAULT_BUNDLE_ORDER,
  });
  const interactions = buildInteractionLayer({ opts, infra, services });
  const appLayer = assembleAppLayer(infra, services, interactions);
  const managedRuntime = ManagedRuntime.make(appLayer);
  const appContext = await managedRuntime.context();
  contextHolder.current = appContext;
  const runtime = makeRuntimeApi(managedRuntime);
  configureJobHandlers({ opts, infra, services, interactions, runtime });
  const app = buildSupervisedApp({
    infra,
    services,
    interactions,
    runtime,
  });
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= managedRuntime.runPromise(app.stop)
      .finally(() => managedRuntime.dispose())
      // Drain in-flight GlitchTip sends before the process goes away (§12).
      .then(() => infra.reporter.flush(SHUTDOWN_REPORTER_FLUSH_MS));
    return stopPromise;
  };
  return {
    get,
    runtime,
    async start() {
      await managedRuntime.runPromise(app.start);
      installSignalHandlers({
        ...app,
        stop: Effect.promise(stop),
      });
      installProcessErrorHandlers(infra.reporter);
    },
    stop,
  };
}

/** Service locator over the app Context — throws until the Layer is built. */
function makeServiceGet(
  contextHolder: { current?: Context.Context<AppServices>; },
): ServiceGet {
  return (key) => {
    const context = contextHolder.current;
    if (!context) throw new Error("AgentKit context is not initialized");
    return Context.getOrElse(context, key, () => {
      throw new Error(`Service not found: ${key.key}`);
    });
  };
}
