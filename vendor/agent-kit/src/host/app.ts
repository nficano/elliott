import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { worstHealth } from "../core/lifecycle.js";
import type { Lifecycle } from "../core/types.js";
import type { AppOpts, AppRunner } from "./app/types.js";
import type { ErrorReporter } from "./observability/types.js";

export type { AppOpts, AppRunner } from "./app/types.js";

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
const CRASH_FLUSH_TIMEOUT_MS = 2000;

const processErrorState = { installed: false };

export function makeApp(
  subsystems: readonly Lifecycle[],
  opts: AppOpts = {},
): AppRunner {
  const started: Lifecycle[] = [];

  const start = Effect.forEach(
    subsystems,
    (s) =>
      Effect.flatMap(
        Effect.promise(() => s.start()),
        () =>
          Effect.sync(() => {
            started.push(s);
          }),
      ),
    { discard: true },
  );

  const stop = Effect.gen(function*() {
    if (opts.onDrain) {
      yield* Effect.race(
        opts.onDrain,
        Effect.sleep(Duration.millis(opts.drainMs ?? DEFAULT_DRAIN_TIMEOUT_MS)),
      );
    }
    for (const s of started.toReversed()) {
      yield* Effect.promise(() => s.stop()).pipe(
        Effect.catchDefect((d) =>
          Effect.sync(() =>
            console.error(
              `supervisor: ${s.name} failed to stop: ${describe(d)}`,
            )
          )
        ),
      );
    }
    started.length = 0;
  });

  const health = Effect.suspend(() =>
    Effect.map(
      Effect.forEach(started, (s) => Effect.promise(() => s.health())),
      worstHealth,
    )
  );

  return { start, stop, health };
}

/** Wire SIGTERM/SIGINT to a graceful stop (§3). */
export function installSignalHandlers(runner: AppRunner): void {
  const onSignal = (sig: string): void => {
    console.info(`supervisor: ${sig} received, draining`);
    void Effect.runPromise(runner.stop).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

/**
 * Crash-path capture (§12). An uncaught exception / unhandled rejection is
 * reported to GlitchTip, flushed best-effort, and THEN the process dies as it
 * would have without these handlers — never swallow-and-continue.
 */
export function installProcessErrorHandlers(reporter: ErrorReporter): void {
  if (processErrorState.installed) return;
  processErrorState.installed = true;
  const die = (error: unknown, mechanism: string): void => {
    console.error(`supervisor: fatal ${mechanism}:`, error);
    reporter.captureException(error, {
      mechanism,
      handled: false,
      level: "fatal",
      tags: { component: "process" },
    });
    void reporter.flush(CRASH_FLUSH_TIMEOUT_MS).finally(() => process.exit(1));
  };
  process.on(
    "uncaughtException",
    (error) => die(error, "onuncaughtexception"),
  );
  process.on(
    "unhandledRejection",
    (reason) => die(reason, "onunhandledrejection"),
  );
}

function describe(d: unknown): string {
  return d instanceof Error ? d.message : String(d);
}
