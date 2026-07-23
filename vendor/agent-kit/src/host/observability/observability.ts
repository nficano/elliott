import {
  type Span as OtelSpan,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import type { Observability, Span, SpanAttrs } from "./types.js";

const TRACE_ID_HEX_LENGTH = 32;
/* eslint-disable no-magic-numbers, unicorn/numeric-separators-style -- OpenTelemetry's standard explicit histogram boundaries. */
const HISTOGRAM_BOUNDARIES = [
  0,
  5,
  10,
  25,
  50,
  75,
  100,
  250,
  500,
  750,
  1_000,
  2_500,
  5_000,
  7_500,
  10_000,
];
/* eslint-enable no-magic-numbers, unicorn/numeric-separators-style */

function cleanAttrs(
  attrs?: SpanAttrs,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!attrs) return out;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v;
  return out;
}

function metricAttrs(attrs?: SpanAttrs): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class OtelSpanWrap implements Span {
  constructor(private readonly s: OtelSpan) {}
  setAttrs(attrs: SpanAttrs): void {
    this.s.setAttributes(cleanAttrs(attrs));
  }
  setError(err: { _tag?: string; message: string; }): void {
    this.s.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    if (err._tag) this.s.setAttribute("error.tag", err._tag);
    this.s.recordException({ name: err._tag ?? "Error", message: err.message });
  }
  end(): void {
    this.s.end();
  }
}

/**
 * The Observability port over OTel. Content-free by construction (§12.1) — the
 * caller only ever passes timing/outcome/id-hash attrs, never prompt/response
 * content.
 */
export class OtelObservability implements Observability {
  private readonly counters = new Map<string, Metric.Counter<number>>();
  private readonly histograms = new Map<string, Metric.Histogram<number>>();
  private readonly gauges = new Map<string, Metric.Gauge<number>>();

  constructor(private readonly tracer: Tracer) {}

  span<T>(
    name: string,
    attrs: SpanAttrs,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { attributes: cleanAttrs(attrs) },
      async (s) => {
        const wrap = new OtelSpanWrap(s);
        try {
          return await fn(wrap);
        } catch (error) {
          wrap.setError({ message: errorMessage(error) });
          throw error;
        } finally {
          s.end();
        }
      },
    );
  }

  startSpan(name: string, attrs?: SpanAttrs): Span {
    return new OtelSpanWrap(
      this.tracer.startSpan(name, { attributes: cleanAttrs(attrs) }),
    );
  }

  counter(name: string, value: number, attrs?: SpanAttrs): void {
    let metric = this.counters.get(name);
    if (!metric) {
      metric = Metric.counter(name, { incremental: true });
      this.counters.set(name, metric);
    }
    Effect.runSync(
      Metric.update(Metric.withAttributes(metric, metricAttrs(attrs)), value),
    );
  }

  histogram(name: string, value: number, attrs?: SpanAttrs): void {
    let metric = this.histograms.get(name);
    if (!metric) {
      metric = Metric.histogram(name, { boundaries: HISTOGRAM_BOUNDARIES });
      this.histograms.set(name, metric);
    }
    Effect.runSync(
      Metric.update(Metric.withAttributes(metric, metricAttrs(attrs)), value),
    );
  }

  gauge(name: string, value: number, attrs?: SpanAttrs): void {
    let metric = this.gauges.get(name);
    if (!metric) {
      metric = Metric.gauge(name);
      this.gauges.set(name, metric);
    }
    Effect.runSync(
      Metric.update(Metric.withAttributes(metric, metricAttrs(attrs)), value),
    );
  }

  recordError(tag: string, message: string, attrs?: SpanAttrs): void {
    this.counter("agentkit.errors", 1, { ...attrs, "error.tag": tag });
    const active = trace.getActiveSpan();
    if (active) {
      active.recordException({ name: tag, message });
      active.setStatus({ code: SpanStatusCode.ERROR, message });
    }
  }

  currentTraceId(): string {
    return trace.getActiveSpan()?.spanContext().traceId
      ?? "0".repeat(TRACE_ID_HEX_LENGTH);
  }

  async shutdown(): Promise<void> {}
}

/** Used when the observability section is disabled — never blocks boot (§1.4). */
export class NoopObservability implements Observability {
  span<T>(
    _n: string,
    _a: SpanAttrs,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return fn(noopSpan);
  }
  startSpan(): Span {
    return noopSpan;
  }
  counter(): void {}
  histogram(): void {}
  gauge(): void {}
  recordError(): void {}
  currentTraceId(): string {
    return "0".repeat(TRACE_ID_HEX_LENGTH);
  }
  async shutdown(): Promise<void> {}
}

const noopSpan: Span = {
  setAttrs() {},
  setError() {},
  end() {},
};
