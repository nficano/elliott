// Subpath imports, not the root barrel — the barrel re-exports WebSdk, which
// hard-requires @opentelemetry/sdk-trace-web (a browser tracer we don't ship).
import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import * as OtelMetrics from "@effect/opentelemetry/OtelMetrics";
import * as OtelTracer from "@effect/opentelemetry/OtelTracer";
import * as Resource from "@effect/opentelemetry/Resource";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { NoopObservability, OtelObservability } from "./observability.js";
import type { Observability, OtelBootstrapOpts } from "./types.js";

const METRIC_EXPORT_INTERVAL_MS = 15_000;
const contextManagerState: {
  manager: AsyncLocalStorageContextManager | undefined;
  users: number;
} = { manager: undefined, users: 0 };

/**
 * OTel layer (§12). One pipeline → one OTLP exporter → the collector, which
 * fans out to SigNoz + Langfuse. The context manager keeps the Promise-shaped
 * Observability port's nested spans connected across async boundaries.
 *
 * Resource attrs use bracket-form dotted keys (oslo lesson, §12.1).
 */
export function makeOtelLayer(
  opts: OtelBootstrapOpts,
  activate: (port: Observability) => void,
): Layer.Layer<never> {
  const resourceLayer = Resource.layer({
    serviceName: opts.serviceName,
    attributes: {
      "deployment.environment": opts.environment,
      "host.name": opts.hostName,
    },
  });
  const tracerProviderLayer = NodeSdk.layerTracerProvider(
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${opts.endpoint}/v1/traces` }),
    ),
  ).pipe(Layer.provideMerge(resourceLayer));
  const signalLayer = Layer.mergeAll(
    OtelTracer.layer,
    OtelMetrics.layer(
      () =>
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${opts.endpoint}/v1/metrics`,
          }),
          exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
        }),
    ),
  ).pipe(Layer.provideMerge(tracerProviderLayer));
  const bindPortLayer = Layer.effectDiscard(
    Effect.gen(function*() {
      const tracer = yield* OtelTracer.OtelTracer;
      yield* Effect.acquireRelease(
        Effect.sync(() => activate(new OtelObservability(tracer))),
        () => Effect.sync(() => activate(new NoopObservability())),
      );
    }),
  );

  return bindPortLayer.pipe(
    Layer.provide(Layer.mergeAll(signalLayer, contextManagerLayer)),
  );
}

const contextManagerLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.sync(acquireContextManager),
    (owned) => Effect.sync(() => releaseContextManager(owned)),
  ),
);

function acquireContextManager(): boolean {
  if (contextManagerState.manager) {
    contextManagerState.users += 1;
    return true;
  }
  const manager = new AsyncLocalStorageContextManager().enable();
  if (!context.setGlobalContextManager(manager)) {
    manager.disable();
    return false;
  }
  contextManagerState.manager = manager;
  contextManagerState.users = 1;
  return true;
}

function releaseContextManager(owned: boolean): void {
  const manager = contextManagerState.manager;
  if (!owned || !manager) return;
  contextManagerState.users -= 1;
  if (contextManagerState.users > 0) return;
  context.disable();
  manager.disable();
  contextManagerState.manager = undefined;
}
