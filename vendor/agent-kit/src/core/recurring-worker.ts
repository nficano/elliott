import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

/** Delay the first run, then repeat without overlapping executions. */
export function repeatAfter(
  operation: Effect.Effect<void>,
  intervalMs: number,
): Effect.Effect<void> {
  return Effect.sleep(intervalMs).pipe(
    Effect.andThen(
      operation.pipe(
        Effect.repeat({ schedule: Schedule.spaced(intervalMs) }),
        Effect.asVoid,
      ),
    ),
  );
}

/** Keep a recurring worker alive after a best-effort Promise operation fails. */
export function ignorePromiseFailure(
  operation: () => Promise<void>,
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: operation,
    catch: () => undefined,
  }).pipe(Effect.ignore, Effect.uninterruptible);
}

/** Register cleanup on an explicitly owned lifecycle scope. */
export function addScopeFinalizer(
  scope: Scope.Scope,
  finalizer: Effect.Effect<void>,
): void {
  Effect.runSync(Scope.addFinalizer(scope, finalizer));
}
