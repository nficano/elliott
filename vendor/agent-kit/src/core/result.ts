import * as Effect from "effect/Effect";
import {
  BudgetExceeded,
  ChannelError,
  ConfigError,
  LlmError,
  McpError,
  MemoryError,
  StoreError,
  ToolError,
} from "./errors.js";
import type { AnyError } from "./types.js";

/**
 * Effect boundary helpers (§1.4). Ports return `Effect.Effect<A, E>` so a
 * degraded subsystem yields an error *value* on the typed error channel instead
 * of throwing and killing the process. These helpers lift a `Promise`-based side
 * effect into that channel, mapping thrown values to the tagged taxonomy
 * (§27.3). Prefer `effect/Effect` combinators directly; reach for these only at
 * a promise boundary.
 */

/**
 * Wrap a promise, mapping any thrown value into a tagged error. An already-tagged
 * throw passes through; otherwise it becomes the supplied fallback tag.
 */
export function guard<T>(
  p: () => Promise<T>,
  onError: (cause: unknown) => AnyError,
): Effect.Effect<T, AnyError> {
  return Effect.tryPromise({
    try: p,
    catch: (
      cause,
    ) => (isAnyError(cause) ? cause : onError(cause)),
  });
}

function isAnyError(cause: unknown): cause is AnyError {
  return cause instanceof ConfigError
    || cause instanceof StoreError
    || cause instanceof LlmError
    || cause instanceof ToolError
    || cause instanceof McpError
    || cause instanceof ChannelError
    || cause instanceof BudgetExceeded
    || cause instanceof MemoryError;
}

/** Convenience for tool handlers whose failures are always `ToolError`. */
export function guardTool<T>(
  p: () => Promise<T>,
  message = "tool execution failed",
): Effect.Effect<T, ToolError> {
  return Effect.tryPromise({
    try: p,
    catch: (
      cause,
    ) => (cause instanceof ToolError
      ? cause
      : new ToolError({ message, cause })),
  });
}
