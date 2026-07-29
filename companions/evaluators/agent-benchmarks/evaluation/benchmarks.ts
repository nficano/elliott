import {
  EvolutionBenchmarkOperation,
  EvolutionBenchmarkResult,
  EvolutionFootprintResult,
} from "../../../../src/learning/evolution/model/index";
import type {
  EvolutionCaseResult,
  EvolutionComparisonRequest,
} from "../../../../src/learning/evolution/model/index";
import { runBenchmark } from "../benchmark";
import { regressionRatio, totalCost, totalLatency } from "./metrics";

type BenchmarkGate = EvolutionComparisonRequest["benchmarkGates"][number];

const notApplicable = (gate: BenchmarkGate): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: gate.benchmarkRef,
    scope: "candidate",
    baselineScore: 0,
    candidateScore: 0,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 0,
    reportDigest: "sha256:not-applicable",
    status: "not-applicable",
    reason: gate.notApplicableReason ?? "not applicable to target",
    passed: true,
  });

const skipped = (gate: BenchmarkGate): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: gate.benchmarkRef,
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

const runGate = async (
  request: EvolutionComparisonRequest,
  gate: BenchmarkGate,
): Promise<EvolutionBenchmarkResult> =>
  runBenchmark(
    EvolutionBenchmarkOperation.make({
      operation: gate.operation,
      run: request.run,
      candidate: request.candidate,
      benchmarkRef: gate.benchmarkRef,
      baselineSnapshotId: request.baselineSnapshotId,
      candidateSnapshotId: request.candidateSnapshotId,
      environmentDigest: request.environmentDigest,
      seed: request.seed,
      timeoutMilliseconds: request.run.budgets.maximumDurationMilliseconds,
      maximumCostUsd: request.run.budgets.maximumCostUsd,
    }),
  );

export const runBenchmarks = async (
  request: EvolutionComparisonRequest,
): Promise<readonly EvolutionBenchmarkResult[]> => {
  const results: EvolutionBenchmarkResult[] = [];
  let blocked = false;
  for (const gate of request.benchmarkGates) {
    if (!gate.applicable) {
      results.push(notApplicable(gate));
      continue;
    }
    if (blocked) {
      results.push(skipped(gate));
      continue;
    }
    const result = await runGate(request, gate);
    results.push(result);
    blocked = !result.passed;
  }
  return results;
};

export const makeFootprints = (input: {
  readonly request: EvolutionComparisonRequest;
  readonly baselineCases: readonly EvolutionCaseResult[];
  readonly candidateCases: readonly EvolutionCaseResult[];
}): readonly EvolutionFootprintResult[] => {
  const { request, baselineCases, candidateCases } = input;
  const measurements = {
    prompt: Buffer.byteLength(request.candidate.materializedContent ?? ""),
    inference: totalCost(candidateCases),
    runtime: totalLatency(candidateCases),
  };
  const observedBaselines = {
    inference: totalCost(baselineCases),
    runtime: totalLatency(baselineCases),
  };
  return request.footprintLimits.map((limit) => {
    const baseline = limit.category === "prompt"
      ? limit.baseline
      : observedBaselines[limit.category];
    const candidate = measurements[limit.category];
    const ratio = regressionRatio(baseline, candidate);
    const passed = ratio <= limit.maximumRegressionRatio;
    return EvolutionFootprintResult.make({
      category: limit.category,
      metric: limit.metric,
      baseline,
      candidate,
      maximumRegressionRatio: limit.maximumRegressionRatio,
      regressionRatio: ratio,
      status: passed ? "passed" : "failed",
      passed,
    });
  });
};
