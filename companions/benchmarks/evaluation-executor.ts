import {
  EvolutionCaseResult,
  EvolutionEvaluateCaseOperation,
} from "../../src/learning/evolution/model/index";
import type {
  EvolutionBaselineRequest,
  EvolutionComparisonRequest,
  EvolutionDatasetCase,
  EvolutionMetricDefinition,
} from "../../src/learning/evolution/model/index";
import {
  canonicalJson,
  decodeUnknown,
  MAX_RESPONSE_BYTES,
  requireLoopbackEndpoint,
  sha256Text,
  wireError,
} from "../typescript/wire";

type EvaluationRequest = EvolutionBaselineRequest | EvolutionComparisonRequest;

const EXECUTOR_FAILURE_STATUS = 500;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const fixtureScore = (
  request: EvaluationRequest,
  evaluationCase: EvolutionDatasetCase,
  snapshotId: string,
): number => {
  const input = evaluationCase.input;
  const scores = isRecord(input) ? input["fixtureScores"] : undefined;
  const candidateSnapshot = request.operation === "compare"
    ? request.candidateSnapshotId
    : undefined;
  const name = candidateSnapshot === snapshotId ? "candidate" : "baseline";
  const score = isRecord(scores) ? scores[name] : undefined;
  return typeof score === "number" && Number.isFinite(score)
    ? score
    : wireError(`fixtureScores.${name} is required`);
};

const fixtureResult = (
  request: EvaluationRequest,
  evaluationCase: EvolutionDatasetCase,
  snapshotId: string,
): EvolutionCaseResult => {
  const score = fixtureScore(request, evaluationCase, snapshotId);
  return EvolutionCaseResult.make({
    caseId: evaluationCase.id,
    split: evaluationCase.split,
    snapshotId,
    metricValues: Object.fromEntries(
      request.metrics.map((metric) => [metric.name, score]),
    ),
    costUsd: 0,
    latencyMilliseconds: 1,
    passed: true,
    trajectoryDigest: sha256Text(
      canonicalJson({
        caseId: evaluationCase.id,
        snapshotId,
        seed: request.seed,
      }),
    ),
  });
};

const readExecutorResponse = async (
  response: Response,
): Promise<unknown> => {
  if (!response.ok) {
    return wireError(
      `evaluation executor returned HTTP ${response.status}`,
      EXECUTOR_FAILURE_STATUS,
    );
  }
  const encoded = await response.text();
  if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
    return wireError(
      "evaluation executor result exceeds the size limit",
      EXECUTOR_FAILURE_STATUS,
    );
  }
  try {
    return JSON.parse(encoded);
  } catch {
    return wireError(
      "evaluation executor returned invalid JSON",
      EXECUTOR_FAILURE_STATUS,
    );
  }
};

const remoteResult = async (input: {
  readonly request: EvaluationRequest;
  readonly evaluationCase: EvolutionDatasetCase;
  readonly snapshotId: string;
  readonly seed: number;
}): Promise<unknown> => {
  const { request, evaluationCase, snapshotId, seed } = input;
  const executor = requireLoopbackEndpoint(
    Bun.env["ELLIOTT_EVALUATION_EXECUTOR_ENDPOINT"],
    Bun.env["ELLIOTT_EVALUATION_EXECUTOR_TOKEN"],
    "evaluation executor",
  );
  const operation = EvolutionEvaluateCaseOperation.make({
    operation: "evaluateCase",
    snapshotId,
    evaluationCase,
    evaluatorRef: request.evaluatorRef,
    evaluationRouteDigest: request.evaluationRouteDigest,
    environmentDigest: request.environmentDigest,
    seed,
  });
  const response = await fetch(
    new URL("/v1/evaluation/case", executor.endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${executor.token}`,
        "content-type": "application/json",
      },
      body: canonicalJson(operation),
      signal: AbortSignal.timeout(evaluationCase.timeoutMilliseconds),
    },
  );
  return readExecutorResponse(response);
};

const validateResult = (input: {
  readonly value: unknown;
  readonly evaluationCase: EvolutionDatasetCase;
  readonly snapshotId: string;
  readonly metrics: readonly EvolutionMetricDefinition[];
}): EvolutionCaseResult => {
  const { value, evaluationCase, snapshotId, metrics } = input;
  const result = decodeUnknown(EvolutionCaseResult, value, "case result");
  if (
    result.caseId !== evaluationCase.id
    || result.split !== evaluationCase.split
    || result.snapshotId !== snapshotId
  ) {
    return wireError("case executor did not attest the requested bindings");
  }
  if (
    result.costUsd > evaluationCase.maximumCostUsd
    || metrics.some(
      (metric) => !Number.isFinite(result.metricValues[metric.name]),
    )
    || result.trajectoryDigest === undefined
  ) {
    return wireError("case executor returned invalid or over-budget evidence");
  }
  return result;
};

const executeEvaluationCase = async (input: {
  readonly request: EvaluationRequest;
  readonly evaluationCase: EvolutionDatasetCase;
  readonly snapshotId: string;
  readonly seed: number;
}): Promise<EvolutionCaseResult> => {
  const { request, evaluationCase, snapshotId, seed } = input;
  const raw = Bun.env["ELLIOTT_COMPANION_FIXTURE"] === "1"
    ? fixtureResult(request, evaluationCase, snapshotId)
    : await remoteResult({ request, evaluationCase, snapshotId, seed });
  return validateResult({
    value: raw,
    evaluationCase,
    snapshotId,
    metrics: request.metrics,
  });
};

export const executeEvaluationCases = (
  request: EvaluationRequest,
  cases: readonly EvolutionDatasetCase[],
  snapshotId: string,
): Promise<readonly EvolutionCaseResult[]> =>
  Promise.all(
    cases.map((evaluationCase, index) =>
      executeEvaluationCase({
        request,
        evaluationCase,
        snapshotId,
        seed: request.seed + index,
      })
    ),
  );
