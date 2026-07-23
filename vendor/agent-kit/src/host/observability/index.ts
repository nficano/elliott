import * as Layer from "effect/Layer";
import { hostname } from "node:os";
import type { Lifecycle } from "../../core/types.js";
import type { AgentKitConfig } from "../config/schema.js";
import { NoopObservability } from "./observability.js";
import { makeOtelLayer } from "./otel.js";
import type { Observability } from "./types.js";

export {
  buildErrorReporter,
  buildEvent,
  makeGlitchtip,
  noopReporter,
  parseDsn,
  parseStack,
} from "./glitchtip.js";
export { NoopObservability, OtelObservability } from "./observability.js";
export type {
  CaptureCtx,
  ErrorReporter,
  Observability,
  SentryEvent,
  SentryFrame,
  Span,
  SpanAttrs,
} from "./types.js";

/**
 * Build the Observability port, its ManagedRuntime-owned telemetry layer, and
 * the supervisor lifecycle compatibility hook. If the `observability` section
 * is absent, we boot Noop — telemetry is best-effort (§1.4).
 */
export function bootObservability(
  cfg: AgentKitConfig,
  env: string,
): {
  port: Observability;
  lifecycle: Lifecycle;
  layer: Layer.Layer<never>;
} {
  if (!cfg.observability) {
    const port = new NoopObservability();
    return {
      port,
      lifecycle: noopLifecycle("observability"),
      layer: Layer.empty,
    };
  }
  const endpoint = cfg.observability.otel.endpoint;
  let port: Observability = new NoopObservability();

  // Consumers created before Layer acquisition still see the activated port.
  const proxy: Observability = {
    span: (n, a, fn) => port.span(n, a, fn),
    startSpan: (n, a) => port.startSpan(n, a),
    counter: (n, v, a) => port.counter(n, v, a),
    histogram: (n, v, a) => port.histogram(n, v, a),
    gauge: (n, v, a) => port.gauge(n, v, a),
    recordError: (t, m, a) => port.recordError(t, m, a),
    currentTraceId: () => port.currentTraceId(),
    shutdown: () => port.shutdown(),
  };
  const layer = makeOtelLayer(
    {
      endpoint,
      serviceName: "agent-kit",
      environment: env,
      hostName: hostname(),
    },
    (next) => {
      port = next;
    },
  );
  return {
    port: proxy,
    lifecycle: noopLifecycle("observability"),
    layer,
  };
}

function noopLifecycle(name: string): Lifecycle {
  return {
    name,
    async start() {},
    async stop() {},
    async health() {
      return { state: "ok" };
    },
  };
}
