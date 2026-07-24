import * as Effect from "effect/Effect";
import { hashBytes } from "../../../core/digest";
import { EvolutionEvaluationError } from "../errors";
import type {
  EvolutionBaselineReport,
  EvolutionBaselineRequest,
  EvolutionComparisonRequest,
  EvolutionEvaluationReport,
} from "../model/index";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const canonicalEvolutionJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const makeEvolutionEvaluationPlanDigest = (
  plan: Omit<EvolutionComparisonRequest, "evaluationPlanDigest">,
): string => hashBytes(canonicalEvolutionJson(plan));

export const makeEvolutionBaselinePlanDigest = (
  plan: Omit<EvolutionBaselineRequest, "evaluationPlanDigest">,
): string => hashBytes(canonicalEvolutionJson(plan));

const baselineTopLevelBindingsMatch = (
  request: EvolutionBaselineRequest,
  report: EvolutionBaselineReport,
): boolean =>
  ([
    [report.runId, request.run.id],
    [report.targetDigest, request.run.target.baselineDigest],
    [report.evaluatorRef, request.evaluatorRef],
    [report.authoringRouteDigest, request.authoringRouteDigest],
    [report.evaluationRouteDigest, request.evaluationRouteDigest],
    [report.baselineSnapshotId, request.baselineSnapshotId],
    [report.datasetDigest, request.dataset.digest],
    [report.validationDigest, request.dataset.splitDigests.validation],
    [report.holdoutDigest, request.dataset.splitDigests.holdout],
    [report.evaluationPlanDigest, request.evaluationPlanDigest],
    [report.environmentDigest, request.environmentDigest],
    [report.seed, request.seed],
  ] as const).every(([actual, expected]) => actual === expected);

const baselineCaseBindingsMatch = (
  request: EvolutionBaselineRequest,
  report: EvolutionBaselineReport,
): boolean => {
  const expected = request.dataset.cases.filter((item) =>
    item.split === "validation" || item.split === "holdout"
  );
  return report.caseResults.length === expected.length
    && expected.every((item, index) =>
      report.caseResults[index]?.caseId === item.id
      && report.caseResults[index]?.split === item.split
      && report.caseResults[index]?.snapshotId === request.baselineSnapshotId
    );
};

const baselineEvidenceBindingsMatch = (
  report: EvolutionBaselineReport,
): boolean => {
  const trajectories = report.caseResults.map((item) => item.trajectoryDigest);
  const categories = new Set(
    report.footprints.map((item) => item.category),
  );
  return trajectories.every((item) => typeof item === "string")
    && JSON.stringify(trajectories) === JSON.stringify(
        report.trajectoryDigests,
      )
    && ["prompt", "inference", "runtime"].every((category) =>
      categories.has(category as "prompt" | "inference" | "runtime")
    );
};

const baselineRequestBindingsMatch = (
  request: EvolutionBaselineRequest,
): boolean => {
  const plan = { ...request } as Record<string, unknown>;
  delete plan["evaluationPlanDigest"];
  return request.authoringRouteDigest !== request.evaluationRouteDigest
    && request.run.state._tag === "dataset-ready"
    && request.run.datasetId === request.dataset.id
    && request.run.datasetDigest === request.dataset.digest
    && request.evaluationPlanDigest
      === hashBytes(canonicalEvolutionJson(plan));
};

export const assertEvolutionBaselineReportBindings = (
  request: EvolutionBaselineRequest,
  report: EvolutionBaselineReport,
): Effect.Effect<void, EvolutionEvaluationError> => {
  return baselineRequestBindingsMatch(request)
      && baselineTopLevelBindingsMatch(request, report)
      && baselineCaseBindingsMatch(request, report)
      && baselineEvidenceBindingsMatch(report)
    ? Effect.void
    : EvolutionEvaluationError.make({
      evaluatorRef: request.evaluatorRef,
      operation: "baseline-report-binding",
      cause: "baseline report does not attest the sealed pre-optimization run",
    });
};

const reportCaseBindingsMatch = (
  request: EvolutionComparisonRequest,
  report: EvolutionEvaluationReport,
): boolean => {
  const expected = request.dataset.cases;
  if (
    report.baselineCases.length !== expected.length
    || report.candidateCases.length !== expected.length
  ) return false;
  return expected.every((evaluationCase, index) => {
    const baseline = report.baselineCases[index];
    const candidate = report.candidateCases[index];
    return baseline?.caseId === evaluationCase.id
      && baseline.split === evaluationCase.split
      && baseline.snapshotId === request.baselineSnapshotId
      && candidate?.caseId === evaluationCase.id
      && candidate.split === evaluationCase.split
      && candidate.snapshotId === request.candidateSnapshotId;
  });
};

const reportGateBindingsMatch = (
  request: EvolutionComparisonRequest,
  report: EvolutionEvaluationReport,
): boolean =>
  request.benchmarkGates.length === report.benchmarks.length
  && request.benchmarkGates.every(
    (gate, index) =>
      report.benchmarks[index]?.benchmarkRef === gate.benchmarkRef,
  );

const reportFootprintsAreComplete = (
  report: EvolutionEvaluationReport,
): boolean => {
  const categories = new Set(
    report.footprints.map((footprint) => footprint.category),
  );
  return ["prompt", "inference", "runtime"].every((category) =>
    categories.has(category as "prompt" | "inference" | "runtime")
  );
};

// Every field is intentionally checked independently at this trust boundary.
/* eslint-disable complexity */
const topLevelBindingsMatch = (
  request: EvolutionComparisonRequest,
  report: EvolutionEvaluationReport,
): boolean =>
  report.runId === request.run.id
  && report.candidateId === request.candidate.id
  && report.evaluatorRef === request.evaluatorRef
  && report.authoringRouteDigest === request.authoringRouteDigest
  && report.evaluationRouteDigest === request.evaluationRouteDigest
  && report.holdoutDigest === request.dataset.splitDigests.holdout
  && report.baselineSnapshotId === request.baselineSnapshotId
  && report.candidateSnapshotId === request.candidateSnapshotId
  && report.datasetDigest === request.dataset.digest
  && report.evaluationPlanDigest === request.evaluationPlanDigest
  && report.environmentDigest === request.environmentDigest
  && report.seed === request.seed;
/* eslint-enable complexity */

export const assertEvolutionEvaluationReportBindings = (
  request: EvolutionComparisonRequest,
  report: EvolutionEvaluationReport,
): Effect.Effect<void, EvolutionEvaluationError> => {
  const plan = { ...request } as Record<string, unknown>;
  delete plan["evaluationPlanDigest"];
  const planDigestMatches = request.evaluationPlanDigest
    === hashBytes(canonicalEvolutionJson(plan));
  return request.authoringRouteDigest !== request.evaluationRouteDigest
      && planDigestMatches
      && topLevelBindingsMatch(request, report)
      && reportCaseBindingsMatch(request, report)
      && reportGateBindingsMatch(request, report)
      && reportFootprintsAreComplete(report)
    ? Effect.void
    : EvolutionEvaluationError.make({
      evaluatorRef: request.evaluatorRef,
      operation: "evaluation-report-binding",
      cause:
        "independent evaluation report does not attest the complete request",
    });
};
