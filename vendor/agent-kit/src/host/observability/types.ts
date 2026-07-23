import type * as Redacted from "effect/Redacted";

/**
 * Observability port (§12). One OTel pipeline behind a slim interface so the
 * rest of the code never imports `@opentelemetry/*` directly. Spans/metrics are
 * CONTENT-FREE by construction (§12.1): timing, outcome, bounded id hashes only,
 * never prompt/response content.
 */

export type SpanAttrs = Record<string, string | number | boolean | undefined>;

export interface Span {
  setAttrs(attrs: SpanAttrs): void;
  setError(err: { _tag?: string; message: string; }): void;
  end(): void;
}

export interface Observability {
  /** Run `fn` inside a span with correct parent/child nesting (§3 M0 spike). */
  span<T>(
    name: string,
    attrs: SpanAttrs,
    fn: (span: Span) => Promise<T>,
  ): Promise<T>;
  startSpan(name: string, attrs?: SpanAttrs): Span;
  counter(name: string, value: number, attrs?: SpanAttrs): void;
  histogram(name: string, value: number, attrs?: SpanAttrs): void;
  gauge(name: string, value: number, attrs?: SpanAttrs): void;
  /** Force-emit a handled Result error that would otherwise be invisible (§27.3). */
  recordError(tag: string, message: string, attrs?: SpanAttrs): void;
  /** Current W3C traceId for propagation into envelopes (§16). */
  currentTraceId(): string;
  shutdown(): Promise<void>;
}

export interface OtelBootstrapOpts {
  readonly endpoint: string; // collector OTLP/HTTP base, e.g. http://otel-collector:4318
  readonly serviceName: string;
  readonly environment: string;
  readonly hostName: string;
}

export interface LangfuseConfig {
  readonly host: string;
  readonly publicKey: string;
  readonly secretKey: Redacted.Redacted<string>;
}

export interface TurnScore {
  readonly traceId: string;
  readonly name: string; // e.g. "rounds_exhausted", "helpfulness"
  readonly value: number; // 0..1 or a boolean-as-0/1
  readonly comment?: string;
}

/**
 * GlitchTip exception reporting (§12). Hand-rolled Sentry wire format — the
 * house rule is NO `@sentry/*` SDK (§12 "No Sentry"); we speak the store-API
 * protocol ourselves. These shapes mirror the Sentry event interchange JSON.
 */

export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

/** One stack frame, Sentry convention: oldest call first in `frames[]`. */
export interface SentryFrame {
  readonly filename: string;
  readonly function?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly in_app: boolean;
}

export interface SentryMechanism {
  readonly type: string;
  readonly handled: boolean;
  /** True when the capture synthesized an Error around a non-Error throwable. */
  readonly synthetic?: boolean;
}

export interface SentryExceptionValue {
  readonly type: string;
  readonly value: string;
  readonly stacktrace?: { readonly frames: readonly SentryFrame[]; };
  readonly mechanism: SentryMechanism;
}

export interface SentryEvent {
  readonly event_id: string; // uuid4, hex, no dashes
  readonly timestamp: string; // ISO 8601
  readonly platform: "javascript";
  readonly level: SentryLevel;
  readonly logger: string;
  readonly server_name?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly tags?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  /** Cause chain, innermost (root cause) first per Sentry ordering. */
  readonly exception: { readonly values: readonly SentryExceptionValue[]; };
}

/** Per-capture context — which seam fired, and its tag taxonomy. */
export interface CaptureCtx {
  readonly level?: SentryLevel;
  readonly logger?: string;
  /** Sentry mechanism type, e.g. "turn" | "tool" | "job" | "onuncaughtexception". */
  readonly mechanism?: string;
  /** true for seam-handled captures; false for process-level crashes. */
  readonly handled?: boolean;
  readonly tags?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
}

/** `buildEvent` context: capture context + the reporter-level identity fields. */
export interface BuildEventCtx extends CaptureCtx {
  readonly environment?: string;
  readonly release?: string;
  readonly serverName?: string;
}

/**
 * The exception-reporting port. `captureException` is fire-and-forget and must
 * NEVER throw; `flush` awaits in-flight sends (shutdown/crash path).
 */
export interface ErrorReporter {
  captureException(error: unknown, ctx?: CaptureCtx): void;
  flush(timeoutMs: number): Promise<void>;
}

export interface GlitchtipDsn {
  /** Scheme + host (+ optional path prefix), no trailing slash. */
  readonly origin: string;
  readonly projectId: string;
  readonly publicKey: string;
}

/** Structural fetch so tests inject a recorder without the full fetch type. */
export type GlitchtipFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; }>;

export interface GlitchtipOpts {
  readonly dsn: string;
  readonly environment?: string;
  readonly release?: string;
  readonly serverName?: string;
  readonly fetchImpl?: GlitchtipFetch;
  /** Called once per N send failures — a capture failure never throws. */
  readonly onError?: (error: unknown, failures: number) => void;
}

/** The decoded `observability.glitchtip` config section. */
export interface GlitchtipSection {
  readonly dsn: string;
  readonly environment?: string | undefined;
  readonly release?: string | undefined;
}

export interface BuildErrorReporterOpts {
  readonly glitchtip?: GlitchtipSection;
  /** Fallback environment when the section doesn't pin one. */
  readonly environment: string;
  /** Invalid-section report hook (§5 optional-section semantics). */
  readonly onInvalid?: (message: string) => void;
}
