import {
  EvolutionBenchmarkResult,
} from "../../../../src/learning/evolution/model/index";
import type { EvolutionBenchmarkOperation } from "../../../../src/learning/evolution/model/index";
import { canonicalJson, sha256Text, wireError } from "../../../runtime/wire";
import {
  type BenchmarkDriver,
  DRIVER_SCOPES,
  operationBinding,
  type ProcessEvidence,
  type RawBenchmarkResultType,
} from "./config";

interface MakeResultInput {
  readonly operation: EvolutionBenchmarkOperation;
  readonly driver: BenchmarkDriver;
  readonly raw: RawBenchmarkResultType;
  readonly processEvidence: ProcessEvidence;
}

interface GateAssessment {
  readonly floor: number;
  readonly scorePassed: boolean;
  readonly budgetPassed: boolean;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

const measurementsValid = (
  raw: RawBenchmarkResultType,
  driver: BenchmarkDriver,
): boolean =>
  Number.isFinite(raw.baselineScore)
  && Number.isFinite(raw.candidateScore)
  && Number.isFinite(raw.costUsd)
  && raw.costUsd >= 0
  && raw.latencyMilliseconds !== undefined
  && raw.latencyMilliseconds >= 0
  && Number.isFinite(driver.maximumRegressionRatio)
  && driver.maximumRegressionRatio >= 0
  && DRIVER_SCOPES.has(driver.scope);

const assessGates = (input: MakeResultInput): GateAssessment => {
  const { operation, driver, raw } = input;
  const floor = raw.baselineScore
    - Math.abs(raw.baselineScore) * driver.maximumRegressionRatio;
  const scorePassed = raw.candidateScore >= floor;
  const budgetPassed = raw.costUsd <= operation.maximumCostUsd;
  return {
    floor,
    scorePassed,
    budgetPassed,
    passed: scorePassed && budgetPassed && raw.driverFailure === undefined,
    reasons: [
      ...(raw.driverFailure === undefined
        ? []
        : [`driver failed: ${raw.driverFailure}`]),
      ...(scorePassed ? [] : [
        `candidate score ${raw.candidateScore} is below regression floor ${floor}`,
      ]),
      ...(budgetPassed ? [] : [
        `cost ${raw.costUsd} exceeds request ceiling ${operation.maximumCostUsd}`,
      ]),
    ],
  };
};

const reportEvidence = (input: MakeResultInput) => {
  const { operation, driver, raw, processEvidence } = input;
  return {
    bindings: operationBinding(operation),
    driver: {
      name: driver.name,
      source: driver.source,
      revision: driver.revision,
    },
    process: processEvidence,
    reportedEvidence: raw.evidence,
    scores: {
      baseline: raw.baselineScore,
      candidate: raw.candidateScore,
    },
    costUsd: raw.costUsd,
    latencyMilliseconds: raw.latencyMilliseconds,
  };
};

export const makeResult = (
  input: MakeResultInput,
): EvolutionBenchmarkResult => {
  const { operation, driver, raw } = input;
  if (
    canonicalJson(raw.bindings) !== canonicalJson(operationBinding(operation))
  ) {
    return wireError("benchmark driver did not attest the requested bindings");
  }
  if (!measurementsValid(raw, driver)) {
    return wireError("benchmark driver returned invalid measurements");
  }
  const latencyMilliseconds = raw.latencyMilliseconds
    ?? wireError("benchmark driver omitted latency");
  const gates = assessGates(input);
  const evidence = {
    ...reportEvidence(input),
    latencyMilliseconds,
  };
  return EvolutionBenchmarkResult.make({
    benchmarkRef: operation.benchmarkRef,
    scope: driver.scope,
    baselineScore: raw.baselineScore,
    candidateScore: raw.candidateScore,
    maximumRegressionRatio: driver.maximumRegressionRatio,
    costUsd: raw.costUsd,
    latencyMilliseconds,
    reportDigest: sha256Text(canonicalJson(evidence)),
    status: gates.passed ? "passed" : "failed",
    ...(gates.reasons.length > 0 && { reason: gates.reasons.join("; ") }),
    passed: gates.passed,
  });
};
