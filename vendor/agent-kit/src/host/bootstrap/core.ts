export type { Infrastructure, ServiceLayer } from "./types.js";
import type { ToolDef } from "../../core/agent/types.js";
import type { ServiceGet } from "../../core/di/services.js";
import { LiteLlmGateway } from "../../core/llm/gateway.js";
import { PgMemory } from "../../core/memory/memory.js";
import { StoreSubsystem } from "../../store/lifecycle.js";
import { makeCapabilityBus } from "../capabilities/bus.js";
import { makeStandardCatalog } from "../capabilities/contracts.js";
import type { CapabilityInvoker } from "../capabilities/types.js";
import type { AgentKitConfig } from "../config/schema.js";
import { ConfigStore } from "../config/store.js";
import { PgFootprintLedger } from "../footprint/ledger.js";
import { delegateTool } from "../jobs/delegate.js";
import { PgJobQueue } from "../jobs/queue.js";
import { WebhookNotify } from "../notify/webhook.js";
import { buildErrorReporter } from "../observability/glitchtip.js";
import { bootObservability } from "../observability/index.js";
import type { ErrorReporter, Observability } from "../observability/types.js";
import { makeRegistry } from "../registry/registry.js";
import type { Registry } from "../registry/types.js";
import { StaticEmbedder } from "../router/embed.js";
import { makeRouter } from "../router/router.js";
import type { Router } from "../router/types.js";
import { buildCoreTools } from "../tools/core-tools.js";
import type { AgentKitOptions, Infrastructure, ServiceLayer } from "./types.js";

const DEFAULT_EMBED_MODEL = "tier-local-embed";
const DEFAULT_MEMORY_RESULT_COUNT = 5;
const DEFAULT_MEMORY_THRESHOLD = 0.3;
const DEFAULT_MEMORY_DEDUPE_COSINE = 0.95;
const DEFAULT_MEMORY_PREVIEW_CHARACTERS = 200;
const DEFAULT_JOB_CONCURRENCY = 4;
const DEFAULT_JOB_LEASE_MS = 120_000;
const DEFAULT_JOB_POLL_MS = 30_000;
const DEFAULT_JOB_MAX_ATTEMPTS = 5;
const DISCLOSURE_CUTOFF_TOKENS = 20_000;
const MAX_SELECTED_BUNDLES = 3;

export async function bootInfrastructure(
  opts: AgentKitOptions,
): Promise<Infrastructure> {
  const config = await ConfigStore.boot({
    dir: opts.configDir,
    env: opts.env,
    ...(opts.appName && { appName: opts.appName }),
    ...(opts.resolver && { resolver: opts.resolver }),
    ...(opts.configOverlay && { overlay: opts.configOverlay }),
  });
  const cfg = config.get();
  const observability = bootObservability(cfg, opts.env);
  const obs = observability.port;
  const reporter = buildReporter(cfg, opts.env, obs);
  const storeSubsystem = new StoreSubsystem(cfg);
  const store = storeSubsystem.store;
  const llm = new LiteLlmGateway({
    baseUrl: cfg.llm.base_url,
    apiKey: cfg.llm.api_key,
    maxParallel: cfg.llm.max_parallel,
    promptCache: cfg.llm.prompt_cache,
    embedModel: cfg.llm.models.embed?.model ?? DEFAULT_EMBED_MODEL,
  });
  const footprint = new PgFootprintLedger(store, obs);
  const memory = new PgMemory(store, llm, {
    embedModel: cfg.llm.models.embed?.model ?? DEFAULT_EMBED_MODEL,
    dim: cfg.store.vectors.dim,
    defaultK: DEFAULT_MEMORY_RESULT_COUNT,
    threshold: DEFAULT_MEMORY_THRESHOLD,
    dedupeCosine: DEFAULT_MEMORY_DEDUPE_COSINE,
    previewMax: DEFAULT_MEMORY_PREVIEW_CHARACTERS,
  });
  const notify = buildNotify(cfg);
  return {
    config,
    cfg,
    obs,
    reporter,
    obsLayer: observability.layer,
    obsLifecycle: observability.lifecycle,
    storeSubsystem,
    store,
    llm,
    footprint,
    memory,
    notify,
  };
}

export function buildServiceLayer(options: {
  readonly opts: AgentKitOptions;
  readonly infra: Infrastructure;
  readonly get: ServiceGet;
  readonly bundleDescriptions: Record<string, string>;
  readonly bundleOrder: string[];
}): ServiceLayer {
  const { opts, infra, get } = options;
  const catalog = makeStandardCatalog();
  opts.contracts?.(catalog);
  const capabilityHolder: { current?: CapabilityInvoker; } = {};
  const registry = makeRegistry({
    config: infra.cfg,
    get,
    obs: infra.obs,
    footprint: infra.footprint,
    catalog,
    caps: () => capabilityHolder.current,
  });
  registry.index(opts.registrables ?? []);
  const caps = makeCapabilityBus({
    catalog,
    registry,
    selections: infra.cfg.capabilities,
    obs: infra.obs,
  });
  capabilityHolder.current = caps;
  const jobs = buildJobQueue(infra);
  const coreTools = (): ToolDef[] => [
    ...buildCoreTools({
      memory: infra.memory,
      ...(infra.notify && { notify: infra.notify }),
      channels: Object.entries(infra.cfg.channels)
        .filter(([, channel]) => channel.enabled)
        .map(([id]) => id),
    }),
    delegateTool(jobs),
    ...(opts.extraCoreTools?.(get) ?? []),
  ];
  const router = buildRouter(options, registry, coreTools);
  return { catalog, registry, caps, jobs, router };
}

/** Invalid section → noop + one error event (§5); never blocks boot (§1.4). */
function buildReporter(
  cfg: AgentKitConfig,
  env: string,
  obs: Observability,
): ErrorReporter {
  return buildErrorReporter({
    ...(cfg.observability?.glitchtip
      && { glitchtip: cfg.observability.glitchtip }),
    environment: env,
    onInvalid: (message) => obs.recordError("ConfigError", message),
  });
}

function buildNotify(cfg: AgentKitConfig): WebhookNotify | undefined {
  return cfg.notify
    ? new WebhookNotify({
      webhookUrl: cfg.notify.webhook_url,
      ...(cfg.notify.token && { token: cfg.notify.token }),
      defaultChannels: [...cfg.notify.default_channels],
    })
    : undefined;
}

function buildJobQueue(infra: Infrastructure): PgJobQueue {
  return new PgJobQueue(infra.store, infra.obs, {
    concurrency: DEFAULT_JOB_CONCURRENCY,
    leaseMs: DEFAULT_JOB_LEASE_MS,
    pollMs: DEFAULT_JOB_POLL_MS,
    maxAttempts: DEFAULT_JOB_MAX_ATTEMPTS,
  }, infra.reporter);
}

function buildRouter(
  options: {
    readonly opts: AgentKitOptions;
    readonly infra: Infrastructure;
    readonly bundleDescriptions: Record<string, string>;
    readonly bundleOrder: string[];
  },
  registry: Registry,
  coreTools: () => ToolDef[],
): Router {
  const { opts, infra } = options;
  return makeRouter({
    registry,
    embedder: new StaticEmbedder(),
    bundleDescriptions: opts.bundleDescriptions ?? options.bundleDescriptions,
    bundleOrder: options.bundleOrder,
    coreTools,
    contextWindowFor: (turn) =>
      infra.cfg.llm.models[turn.tier]?.context_window ?? 0,
    disclosureCutoffTokens: DISCLOSURE_CUTOFF_TOKENS,
    maxBundles: MAX_SELECTED_BUNDLES,
    onCatalogError: (id, message) =>
      infra.obs.recordError(
        "ConfigError",
        `catalog: '${id}' failed to activate: ${message}`,
        { "agentkit.component.id": id },
      ),
  });
}
