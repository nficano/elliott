import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { hashValue } from "../../../core/digest";
import { EvolutionEvaluationError } from "../errors";
import {
  EvolutionBaselineReport,
  EvolutionBaselineRequest,
  EvolutionMetricDefinition,
} from "../model/index";
import {
  assertEvolutionBaselineReportBindings,
  makeEvolutionBaselinePlanDigest,
} from "./bindings";
import type {
  RuntimeBaselineController,
  RuntimeBaselineControllerInput,
} from "./types";

const routes = (
  input: RuntimeBaselineControllerInput,
): Effect.Effect<
  { readonly authoring: string; readonly evaluation: string; },
  EvolutionEvaluationError
> =>
  input.authoringRouteDigest !== undefined
    && input.evaluationRouteDigest !== undefined
    && input.authoringRouteDigest !== input.evaluationRouteDigest
    ? Effect.succeed({
      authoring: input.authoringRouteDigest,
      evaluation: input.evaluationRouteDigest,
    })
    : EvolutionEvaluationError.make({
      evaluatorRef: input.evaluatorRef,
      operation: "baseline-independent-route",
      cause: "distinct authoring and evaluation routes are required",
    });

const validateInput = (
  dependencies: RuntimeBaselineControllerInput,
  input: Parameters<RuntimeBaselineController["measure"]>[0],
) =>
  input.run.state._tag === "dataset-ready"
    && input.run.datasetId === input.dataset.id
    && input.run.datasetDigest === input.dataset.digest
    && input.dataset.targetDigest === input.run.target.baselineDigest
    ? Effect.void
    : EvolutionEvaluationError.make({
      evaluatorRef: dependencies.evaluatorRef,
      operation: "baseline-request-binding",
      cause: "baseline requires the run's sealed dataset before optimization",
    });

const makeRequest = (
  dependencies: RuntimeBaselineControllerInput,
  input: Parameters<RuntimeBaselineController["measure"]>[0],
) =>
  Effect.gen(function*() {
    yield* validateInput(dependencies, input);
    const route = yield* routes(dependencies);
    const plan = {
      operation: "baseline" as const,
      run: input.run,
      dataset: input.dataset,
      baselineSnapshotId: input.run.baselineSnapshotId,
      evaluatorRef: dependencies.evaluatorRef,
      authoringRouteDigest: route.authoring,
      evaluationRouteDigest: route.evaluation,
      environmentDigest: dependencies.environmentDigest,
      seed: input.seed,
      targetFootprintBytes: Buffer.byteLength(input.baselineContent),
      metrics: [
        EvolutionMetricDefinition.make({
          name: "correctness",
          direction: "maximize",
          weight: 1,
          regressionFloor: 0,
        }),
      ],
    };
    return EvolutionBaselineRequest.make({
      ...plan,
      evaluationPlanDigest: makeEvolutionBaselinePlanDigest(plan),
    });
  });

const recordBaseline = (
  dependencies: RuntimeBaselineControllerInput,
  input: Parameters<RuntimeBaselineController["measure"]>[0],
  report: EvolutionBaselineReport,
) =>
  Effect.tryPromise({
    try: () =>
      dependencies.records.append({
        type: "evolution.baseline.completed",
        scope: {
          level: "workspace",
          id: scopeId(input.run.target.componentRef),
        },
        durability: "observational",
        classification: "internal",
        payload: {
          reportId: report.id,
          runId: report.runId,
          targetRef: input.run.target.componentRef,
          targetDigest: report.targetDigest,
          snapshotId: report.baselineSnapshotId,
          datasetDigest: report.datasetDigest,
          validationDigest: report.validationDigest,
          holdoutDigest: report.holdoutDigest,
          caseResultsDigest: hashValue(report.caseResults),
          trajectoryDigests: report.trajectoryDigests,
          footprints: report.footprints,
          totalCostUsd: report.totalCostUsd,
          totalLatencyMilliseconds: report.totalLatencyMilliseconds,
          authoringRouteDigest: report.authoringRouteDigest,
          evaluationRouteDigest: report.evaluationRouteDigest,
          environmentDigest: report.environmentDigest,
          seed: report.seed,
        },
      }),
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: dependencies.evaluatorRef,
        operation: "record-baseline",
        cause,
      }),
  });

export const makeRuntimeEvolutionBaselineController = (
  dependencies: RuntimeBaselineControllerInput,
): RuntimeBaselineController => ({
  measure: Effect.fn("measureRuntimeEvolutionBaseline")(function*(input) {
    const request = yield* makeRequest(dependencies, input);
    const report = yield* dependencies.evaluator.baseline(request);
    yield* assertEvolutionBaselineReportBindings(request, report);
    yield* dependencies.reports.save(report);
    yield* recordBaseline(dependencies, input, report);
    return report;
  }),
});
