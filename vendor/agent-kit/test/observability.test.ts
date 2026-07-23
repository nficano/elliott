import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import { OtelObservability } from "../src/host/observability/observability.js";

const ZERO_TRACE_ID = "0".repeat(32);

describe("Effect OpenTelemetry observability", () => {
  test("keeps nested Promise spans connected and records unknown failures", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const manager = new AsyncLocalStorageContextManager().enable();
    expect(context.setGlobalContextManager(manager)).toBe(true);
    const obs = new OtelObservability(provider.getTracer("agent-kit-test"));
    let traceId = ZERO_TRACE_ID;

    try {
      await expect(
        obs.span(
          "parent",
          { "gen_ai.request.model": "test-model" },
          async () => {
            traceId = obs.currentTraceId();
            await Promise.resolve();
            await obs.span(
              "child",
              {},
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- verifies unknown rejection normalization.
              () => Promise.reject("non-error failure"),
            );
          },
        ),
      ).rejects.toBe("non-error failure");
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((span) => span.name === "parent");
      const child = spans.find((span) => span.name === "child");
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      expect(traceId).not.toBe(ZERO_TRACE_ID);
      expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
      expect(child?.parentSpanContext?.spanId).toBe(
        parent?.spanContext().spanId,
      );
      expect(child?.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: "non-error failure",
      });
      expect(parent?.attributes["gen_ai.request.model"]).toBe("test-model");
    } finally {
      context.disable();
      manager.disable();
      await provider.shutdown();
    }
  });

  test("retains custom counters, histograms, gauges, and attributes", () => {
    const provider = new BasicTracerProvider();
    const obs = new OtelObservability(provider.getTracer("agent-kit-test"));
    const suffix = crypto.randomUUID();
    const counterName = `agentkit.test.counter.${suffix}`;
    const histogramName = `agentkit.test.histogram.${suffix}`;
    const gaugeName = `agentkit.test.gauge.${suffix}`;
    const attrs = { attempt: 3, healthy: true };

    obs.counter(counterName, 2, attrs);
    obs.histogram(histogramName, 42, attrs);
    obs.gauge(gaugeName, 7, attrs);

    const snapshots = Effect.runSync(Metric.snapshot);
    expect(snapshots.find((snapshot) => snapshot.id === counterName))
      .toMatchObject({
        attributes: { attempt: "3", healthy: "true" },
        state: { count: 2 },
        type: "Counter",
      });
    expect(snapshots.find((snapshot) => snapshot.id === histogramName))
      .toMatchObject({
        attributes: { attempt: "3", healthy: "true" },
        state: { count: 1, max: 42, min: 42, sum: 42 },
        type: "Histogram",
      });
    expect(snapshots.find((snapshot) => snapshot.id === gaugeName))
      .toMatchObject({
        attributes: { attempt: "3", healthy: "true" },
        state: { value: 7 },
        type: "Gauge",
      });
  });
});
