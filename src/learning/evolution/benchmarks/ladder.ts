import * as Effect from "effect/Effect";
import { EvolutionEvaluationError } from "../errors";
import { EvolutionBenchmarkResult } from "../model/index";
import type { EvolutionBenchmarkLadderInput } from "./types";

const notApplicableResult = (
  stage: EvolutionBenchmarkLadderInput["stages"][number],
): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: stage.benchmarkRef,
    scope: "candidate",
    baselineScore: 0,
    candidateScore: 0,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 0,
    reportDigest: "sha256:not-applicable",
    status: "not-applicable",
    reason: stage.notApplicableReason ?? "not applicable to target",
    passed: true,
  });

const skippedResult = (
  stage: EvolutionBenchmarkLadderInput["stages"][number],
): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: stage.benchmarkRef,
    scope: "candidate",
    baselineScore: 0,
    candidateScore: 0,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 0,
    reportDigest: "sha256:skipped",
    status: "skipped",
    reason: "a preceding required gate failed",
    passed: false,
  });

export const runBenchmarkLadder = Effect.fn("runEvolutionBenchmarkLadder")(
  function*(input: EvolutionBenchmarkLadderInput) {
    const results: EvolutionBenchmarkResult[] = [];
    let blocked = false;
    for (const stage of input.stages) {
      if (!stage.applicable) {
        results.push(notApplicableResult(stage));
        continue;
      }
      if (blocked) {
        results.push(skippedResult(stage));
        continue;
      }
      const result = yield* stage.run(
        input.run,
        input.candidate,
        input.context,
      );
      if (result.benchmarkRef !== stage.benchmarkRef) {
        return yield* EvolutionEvaluationError.make({
          evaluatorRef: stage.benchmarkRef,
          operation: "benchmark-result-binding",
          cause:
            `expected ${stage.benchmarkRef}, received ${result.benchmarkRef}`,
        });
      }
      results.push(result);
      blocked = !result.passed;
    }
    return results;
  },
);
