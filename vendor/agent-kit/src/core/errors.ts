import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Flatten a Schema decode failure into `path: message; path: message`. The one
 * formatter shared by every decode boundary (§5 config load, TDD §3.5 capability
 * bus) so issue-path rendering lives in exactly one place.
 */
export function formatSchemaError(error: Schema.SchemaError): string {
  return SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
}

function formatIssuePath(path: ReadonlyArray<unknown> | undefined): string {
  return path?.length ? path.map(formatPathSegment).join(".") : "(root)";
}

function formatPathSegment(segment: unknown): string {
  let value = segment;
  if (typeof value === "object" && value !== null && "key" in value) {
    value = value.key;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "symbol") {
    return value.description ?? value.toString();
  }
  return "<unknown>";
}

/**
 * Tagged error taxonomy — ARCHITECTURE §27.3.
 *
 * "Errors are values; nothing blocks boot" (§1.4). Each error is a
 * tagged yieldable error so it rides Effect's typed error channel directly (the
 * `E` in `Effect.Effect<A, E, R>`), works with `Effect.catchTag`, and is still
 * a real `Error`. Schema-shaped payloads use `Schema.TaggedErrorClass`;
 * payloads carrying arbitrary causes remain `Data.TaggedError`. Every error
 * exposes `retryable`; the transient-retry combinator (§7.1) keys off it.
 * Construction is `new XError({ ...fields })`.
 */

/** §5 config validation. Never retryable — fail fast or disable the section. */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly retryable = false;
}

/** Postgres (§3/§20). Transient (conn/timeout) retryable; constraint violations not. */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string;
  readonly kind: "transient" | "constraint" | "unavailable";
  readonly cause?: unknown;
}> {
  get retryable(): boolean {
    return this.kind !== "constraint";
  }
}

/** §7.1 LiteLLM gateway. 429/5xx/network retryable; 4xx not. */
export class LlmError extends Data.TaggedError("LlmError")<{
  readonly message: string;
  readonly kind: "http" | "network" | "protocol";
  readonly status?: number;
  readonly cause?: unknown;
}> {
  get retryable(): boolean {
    if (this.kind === "network") return true;
    if (this.kind === "protocol") return false;
    if (this.status === undefined) return false;
    return (
      this.status === HTTP_TOO_MANY_REQUESTS
      || this.status >= HTTP_SERVER_ERROR_MIN
    );
  }
}

/** §7.2 tool execution. Tool-defined; default not retryable. */
export class ToolError extends Data.TaggedError("ToolError")<{
  readonly message: string;
  /** Stored under `_retryable` so the public `retryable` getter never collides. */
  readonly _retryable?: boolean;
  readonly cause?: unknown;
}> {
  get retryable(): boolean {
    return this._retryable ?? false;
  }
}

/** §7.5 MCP client. connect: retryable (circuit-broken); call: not. */
export class McpError extends Data.TaggedError("McpError")<{
  readonly message: string;
  readonly phase: "connect" | "call";
  readonly cause?: unknown;
}> {
  get retryable(): boolean {
    return this.phase === "connect";
  }
}

/** §16 channel adapters. Delivery 5xx/limit retryable (chunk/retry); auth not. */
export class ChannelError extends Data.TaggedError("ChannelError")<{
  readonly message: string;
  readonly kind: "delivery" | "auth" | "limit";
  readonly cause?: unknown;
}> {
  get retryable(): boolean {
    return this.kind !== "auth";
  }
}

/** §11 guardrails. Hard stop — never retryable. */
export class BudgetExceeded
  extends Schema.TaggedErrorClass<BudgetExceeded>()("BudgetExceeded", {
    message: Schema.String,
    scope: Schema.Literals([
      "per_turn_usd",
      "monthly_usd",
      "cold_tokens",
    ]),
  })
{
  readonly retryable = false;
}

/** §7.4 memory. Best-effort — degrade, never block; retryable. */
export class MemoryError extends Data.TaggedError("MemoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly retryable = true;
}

/** A tagged error is any object with a string `_tag` + `message` + `retryable`. */
export function isTaggedError(
  e: unknown,
): e is { _tag: string; message: string; retryable: boolean; } {
  return (
    Predicate.hasProperty(e, "_tag")
    && Predicate.isString(e._tag)
    && Predicate.hasProperty(e, "message")
    && Predicate.isString(e.message)
    && Predicate.hasProperty(e, "retryable")
    && Predicate.isBoolean(e.retryable)
  );
}
