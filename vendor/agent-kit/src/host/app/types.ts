import type * as Effect from "effect/Effect";
import type { Health } from "../../core/types.js";

/**
 * Process supervision as Effect programs (§3, Phase B). Ordered startup +
 * graceful shutdown of Promise-shaped subsystems: `observability → store →
 * footprint → channels → scheduler → workers → http`. Scoped telemetry itself
 * is acquired and released by the app ManagedRuntime; its compatibility
 * lifecycle keeps health and ordering stable. `start` runs lifecycles in order;
 * `stop` drains in-flight turns (§20) then stops them in REVERSE.
 */
export interface AppRunner {
  /** Start every subsystem in order (records what started for reverse teardown). */
  readonly start: Effect.Effect<void>;
  /** Drain, then stop started subsystems in reverse; a failed stop is logged, not fatal. */
  readonly stop: Effect.Effect<void>;
  /** Aggregate readiness — the worst state across started subsystems (§3 /readyz). */
  readonly health: Effect.Effect<Health>;
}

export interface AppOpts {
  readonly drainMs?: number;
  /** In-flight-turn drain, raced against `drainMs` before teardown (§20). */
  readonly onDrain?: Effect.Effect<void>;
}
