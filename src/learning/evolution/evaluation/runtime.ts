/* eslint-disable max-lines-per-function */
import * as Effect from "effect/Effect";
import { componentRef, snapshotId } from "../../../core/brands";
import { hashValue } from "../../../core/digest";
import type { EvolutionEvaluationRequestFactoryShape } from "../application/types";
import { REQUIRED_PREPROMOTION_BENCHMARK_GATES } from "../benchmarks/required";
import { EvolutionEvaluationError } from "../errors";
import {
  EvolutionComparisonRequest,
  EvolutionEvaluationBenchmarkGate,
  EvolutionFootprintLimit,
  EvolutionMetricDefinition,
} from "../model/index";
import type {
  EvolutionCandidate,
  EvolutionDatasetManifest,
  EvolutionRun,
} from "../model/index";
import { makeEvolutionEvaluationPlanDigest } from "./bindings";
import type { RuntimeEvaluationRequestFactoryInput } from "./types";

const DEFAULT_BOOTSTRAP_ITERATIONS = 1000;
const DEFAULT_CONFIDENCE_LEVEL = 0.95;
const DEFAULT_FOOTPRINT_REGRESSION_RATIO = 0.1;

const candidateSnapshot = (
  input: RuntimeEvaluationRequestFactoryInput,
  run: EvolutionRun,
  candidate: EvolutionCandidate,
): Effect.Effect<string, EvolutionEvaluationError> =>
  Effect.try({
    try: () => {
      const baseline = input.snapshots.get(snapshotId(run.baselineSnapshotId));
      if (baseline === undefined) {
        throw new Error("baseline Snapshot is unavailable");
      }
      if (candidate.materializedContent === undefined) {
        throw new Error("candidate has no materialized content");
      }
      const existing = input.snapshots.list().find((item) =>
        item.previous === baseline.id
        && item.configuration["evolutionEvaluationRunId"] === run.id
        && item.configuration["evolutionEvaluationCandidateId"] === candidate.id
        && item.configuration["evolutionEvaluationCandidateDigest"]
          === candidate.candidateDigest
      );
      if (existing !== undefined) return existing.id;
      const targetComponent = {
        ref: componentRef(run.target.componentRef),
        manifestDigest: hashValue({
          targetRef: run.target.componentRef,
          evaluationCandidate: true,
        }),
        configDigest: hashValue(candidate.candidateDigest),
      };
      const components = [
        ...baseline.components.filter((item) =>
          item.ref !== run.target.componentRef
        ),
        targetComponent,
      ];
      return input.snapshots.create({
        configurationDigest: hashValue({
          baseline: baseline.configurationDigest,
          runId: run.id,
          candidateId: candidate.id,
          candidateDigest: candidate.candidateDigest,
        }),
        registryDigest: baseline.registryDigest,
        components,
        configuration: {
          ...baseline.configuration,
          evolutionEvaluationRunId: run.id,
          evolutionEvaluationCandidateId: candidate.id,
          evolutionEvaluationCandidateDigest: candidate.candidateDigest,
          evolutionEvaluationTargetRef: run.target.componentRef,
          evolutionEvaluationTargetClass: run.target.targetClass,
          evolutionEvaluationTargetContent: candidate.materializedContent,
        },
        previous: baseline.id,
      }).id;
    },
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: input.evaluatorRef,
        operation: "candidate-snapshot",
        cause,
      }),
  });

const benchmarkGates = (
  targetClass: EvolutionRun["target"]["targetClass"],
) =>
  REQUIRED_PREPROMOTION_BENCHMARK_GATES.map((gate) => {
    const applicable = gate.targetClasses.includes(targetClass);
    return EvolutionEvaluationBenchmarkGate.make({
      benchmarkRef: gate.benchmarkRef,
      operation: gate.operation,
      applicable,
      ...(!applicable && {
        notApplicableReason:
          `${gate.benchmarkRef} does not apply to ${targetClass}`,
      }),
    });
  });

const footprintLimits = (
  baselineContent: string,
): readonly EvolutionFootprintLimit[] => [
  EvolutionFootprintLimit.make({
    category: "prompt",
    metric: "target-utf8-bytes",
    baseline: Buffer.byteLength(baselineContent),
    maximumRegressionRatio: DEFAULT_FOOTPRINT_REGRESSION_RATIO,
  }),
  EvolutionFootprintLimit.make({
    category: "inference",
    metric: "evaluation-cost-usd",
    baseline: 0,
    maximumRegressionRatio: DEFAULT_FOOTPRINT_REGRESSION_RATIO,
  }),
  EvolutionFootprintLimit.make({
    category: "runtime",
    metric: "evaluation-latency-milliseconds",
    baseline: 0,
    maximumRegressionRatio: DEFAULT_FOOTPRINT_REGRESSION_RATIO,
  }),
];

const assertRouteConfiguration = (
  input: RuntimeEvaluationRequestFactoryInput,
): Effect.Effect<
  { readonly authoring: string; readonly evaluation: string; },
  EvolutionEvaluationError
> => {
  const authoring = input.authoringRouteDigest;
  const evaluation = input.evaluationRouteDigest;
  return authoring !== undefined
      && evaluation !== undefined
      && authoring !== evaluation
    ? Effect.succeed({ authoring, evaluation })
    : EvolutionEvaluationError.make({
      evaluatorRef: input.evaluatorRef,
      operation: "independent-route",
      cause:
        "distinct ELLIOTT_EVOLUTION_AUTHORING_ROUTE_DIGEST and ELLIOTT_EVOLUTION_EVALUATION_ROUTE_DIGEST values are required",
    });
};

export const makeRuntimeEvolutionEvaluationRequestFactory = (
  input: RuntimeEvaluationRequestFactoryInput,
): EvolutionEvaluationRequestFactoryShape => ({
  build: Effect.fn("buildRuntimeEvolutionEvaluationRequest")(function*(
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    dataset: EvolutionDatasetManifest,
  ) {
    const routes = yield* assertRouteConfiguration(input);
    const materialized = yield* input.targets.resolve(
      run.target.componentRef,
    );
    if (
      materialized.target.baselineDigest !== run.target.baselineDigest
      || candidate.runId !== run.id
      || dataset.id !== run.datasetId
      || dataset.digest !== run.datasetDigest
    ) {
      return yield* EvolutionEvaluationError.make({
        evaluatorRef: input.evaluatorRef,
        operation: "evaluation-request-binding",
        cause: "run inputs changed before independent evaluation",
      });
    }
    const candidateSnapshotId = yield* candidateSnapshot(
      input,
      run,
      candidate,
    );
    const plan = {
      operation: "compare" as const,
      run,
      candidate,
      dataset,
      baselineSnapshotId: run.baselineSnapshotId,
      candidateSnapshotId,
      evaluatorRef: input.evaluatorRef,
      authoringRouteDigest: routes.authoring,
      evaluationRouteDigest: routes.evaluation,
      environmentDigest: input.environmentDigest,
      seed: run.optimizationSeed ?? dataset.splitSeed,
      metrics: [
        EvolutionMetricDefinition.make({
          name: "correctness",
          direction: "maximize",
          weight: 1,
          regressionFloor: 0,
        }),
      ],
      confidenceLevel: DEFAULT_CONFIDENCE_LEVEL,
      bootstrapIterations: DEFAULT_BOOTSTRAP_ITERATIONS,
      multipleComparisonCount: run.state._tag === "shortlisted"
        ? Math.max(1, run.state.candidateIds.length)
        : 1,
      requiredConstraints: [
        ...new Set(candidate.constraints.map((item) => item.constraint)),
      ],
      benchmarkGates: benchmarkGates(run.target.targetClass),
      footprintLimits: footprintLimits(materialized.baselineContent),
    };
    return EvolutionComparisonRequest.make({
      ...plan,
      evaluationPlanDigest: makeEvolutionEvaluationPlanDigest(plan),
    });
  }),
});
