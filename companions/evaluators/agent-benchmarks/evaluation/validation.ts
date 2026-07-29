import type {
  EvolutionBaselineRequest,
  EvolutionComparisonRequest,
  EvolutionDatasetManifest,
  EvolutionMetricDefinition,
} from "../../../../src/learning/evolution/model/index";
import {
  EvolutionBaselineRequest as BaselineRequestSchema,
  EvolutionComparisonRequest as ComparisonRequestSchema,
} from "../../../../src/learning/evolution/model/index";
import {
  canonicalJson,
  decodeUnknown,
  sha256Text,
  wireError,
} from "../../../runtime/wire";
import { configuredBenchmarkReferences } from "../benchmark";

const SPLITS = new Set(["train", "validation", "holdout"]);
const FOOTPRINT_CATEGORIES = [
  "prompt",
  "inference",
  "runtime",
] as const;

const withoutPlanDigest = (
  request: EvolutionBaselineRequest | EvolutionComparisonRequest,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(request).filter(
      ([name]) => name !== "evaluationPlanDigest",
    ),
  );

const validateDataset = (dataset: EvolutionDatasetManifest): void => {
  const ids = new Set<string>();
  const splits = new Set<string>();
  for (const evaluationCase of dataset.cases) {
    if (
      ids.has(evaluationCase.id)
      || !SPLITS.has(evaluationCase.split)
    ) return wireError("dataset cases must have unique ids and valid splits");
    ids.add(evaluationCase.id);
    splits.add(evaluationCase.split);
  }
  if (
    dataset.cases.length === 0
    || [...SPLITS].some((split) => !splits.has(split))
  ) return wireError("evaluation dataset must contain every split");
};

const validateMetrics = (
  metrics: readonly EvolutionMetricDefinition[],
): void => {
  const names = new Set(metrics.map((metric) => metric.name));
  if (
    metrics.length === 0
    || names.size !== metrics.length
    || metrics.some((metric) =>
      !Number.isFinite(metric.weight)
      || !Number.isFinite(metric.regressionFloor)
    )
  ) return wireError("metric definitions are incomplete or duplicated");
};

const validatePlanDigest = (
  request: EvolutionBaselineRequest | EvolutionComparisonRequest,
  label: string,
): void => {
  const digest = sha256Text(canonicalJson(withoutPlanDigest(request)));
  if (digest !== request.evaluationPlanDigest) {
    return wireError(`${label} evaluation plan digest mismatch`);
  }
};

export const validateBaselineRequest = (
  value: unknown,
): EvolutionBaselineRequest => {
  const request = decodeUnknown(
    BaselineRequestSchema,
    value,
    "baseline request",
  );
  validateDataset(request.dataset);
  validateMetrics(request.metrics);
  const state = request.run.state;
  if (
    state._tag !== "dataset-ready"
    || state.datasetId !== request.dataset.id
    || state.datasetDigest !== request.dataset.digest
    || request.run.datasetId !== request.dataset.id
    || request.run.datasetDigest !== request.dataset.digest
    || request.dataset.targetDigest !== request.run.target.baselineDigest
    || !request.dataset.holdoutSealed
    || request.baselineSnapshotId !== request.run.baselineSnapshotId
  ) return wireError("baseline requires the run's sealed dataset");
  if (request.authoringRouteDigest === request.evaluationRouteDigest) {
    return wireError("authoring and evaluation routes must be distinct");
  }
  validatePlanDigest(request, "baseline");
  return request;
};

const validateCandidate = (request: EvolutionComparisonRequest): void => {
  const state = request.run.state;
  if (
    state._tag !== "shortlisted"
    || !state.candidateIds.includes(request.candidate.id)
    || request.candidate.runId !== request.run.id
    || request.candidate.targetDigest !== request.run.target.baselineDigest
  ) return wireError("candidate is not in a sealed shortlist");
  const constraints = new Map(
    request.candidate.constraints.map((item) => [item.constraint, item]),
  );
  if (
    constraints.size !== request.candidate.constraints.length
    || request.requiredConstraints.some(
      (name) => constraints.get(name)?.passed !== true,
    )
  ) return wireError("required candidate constraints failed");
};

const validateFootprints = (request: EvolutionComparisonRequest): void => {
  const categories = new Set(
    request.footprintLimits.map((item) => item.category),
  );
  if (
    categories.size !== request.footprintLimits.length
    || FOOTPRINT_CATEGORIES.some((item) => !categories.has(item))
  ) return wireError("prompt, inference, and runtime limits are required");
};

const validateBenchmarks = async (
  request: EvolutionComparisonRequest,
): Promise<void> => {
  const configured = await configuredBenchmarkReferences();
  const requested = new Set(
    request.benchmarkGates.map((gate) => gate.benchmarkRef),
  );
  if (
    requested.size !== request.benchmarkGates.length
    || requested.size !== configured.size
    || [...configured].some((reference) => !requested.has(reference))
    || request.benchmarkGates.some((gate) =>
      !gate.applicable
      && (
        gate.notApplicableReason === undefined
        || gate.notApplicableReason.length === 0
      )
    )
  ) return wireError("request does not contain the complete benchmark ladder");
};

export const validateComparisonRequest = async (
  value: unknown,
): Promise<EvolutionComparisonRequest> => {
  const request = decodeUnknown(
    ComparisonRequestSchema,
    value,
    "comparison request",
  );
  validateDataset(request.dataset);
  validateMetrics(request.metrics);
  validateCandidate(request);
  validateFootprints(request);
  await validateBenchmarks(request);
  if (
    request.run.datasetId !== request.dataset.id
    || request.run.datasetDigest !== request.dataset.digest
    || request.dataset.targetDigest !== request.run.target.baselineDigest
    || !request.dataset.holdoutSealed
  ) return wireError("sealed dataset is not bound to the run target");
  if (
    request.baselineSnapshotId !== request.run.baselineSnapshotId
    || request.baselineSnapshotId === request.candidateSnapshotId
  ) return wireError("evaluation snapshots are not bound to the run");
  if (request.authoringRouteDigest === request.evaluationRouteDigest) {
    return wireError("authoring and evaluation routes must be distinct");
  }
  if (request.candidate.materializedContent === undefined) {
    return wireError("candidate materializedContent is required");
  }
  validatePlanDigest(request, "comparison");
  return request;
};
