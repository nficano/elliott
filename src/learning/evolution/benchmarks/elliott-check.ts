import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";
import { EvolutionEvaluationError } from "../errors";
import { EvolutionBenchmarkResult } from "../model/index";
import type { ElliottCheckInput } from "./types";

const spawnCheck = (input: ElliottCheckInput) =>
  Effect.try({
    try: () =>
      Bun.spawn(["bun", "run", "check"], {
        cwd: input.checkout,
        stdout: "pipe",
        stderr: "pipe",
      }),
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: "core/evaluator/elliott-check",
        operation: "spawn",
        cause,
      }),
  });

const waitForCheck = (
  process: ReturnType<typeof Bun.spawn>,
  timeoutMilliseconds: number,
) =>
  Effect.tryPromise({
    try: () => process.exited,
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: "core/evaluator/elliott-check",
        operation: "wait",
        cause,
      }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMilliseconds,
      orElse: () =>
        Effect.sync(() => process.kill()).pipe(
          Effect.flatMap(() =>
            Effect.fail(EvolutionEvaluationError.make({
              evaluatorRef: "core/evaluator/elliott-check",
              operation: "timeout",
              cause: `exceeded ${timeoutMilliseconds}ms`,
            }))
          ),
        ),
    }),
  );

export const runElliottCheck = Effect.fn("runElliottCheckBenchmark")(function*(
  input: ElliottCheckInput,
) {
  const startedAt = performance.now();
  const process = yield* spawnCheck(input);
  const exitCode = yield* waitForCheck(process, input.timeoutMilliseconds);
  const passed = exitCode === 0;
  const reportDigest = `sha256:${
    createHash("sha256")
      .update(JSON.stringify({
        candidateDigest: input.candidate.candidateDigest,
        exitCode,
      }))
      .digest("hex")
  }`;
  return EvolutionBenchmarkResult.make({
    benchmarkRef: "core/evaluator/elliott-check",
    scope: "candidate",
    baselineScore: input.baselinePassed ? 1 : 0,
    candidateScore: passed ? 1 : 0,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: Math.round(performance.now() - startedAt),
    reportDigest,
    status: passed ? "passed" : "failed",
    passed,
  });
});
