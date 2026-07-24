import * as Effect from "effect/Effect";
import { validateEvolutionDatasetManifest } from "../datasets/builder";
import {
  EvolutionDatasetError,
  EvolutionEvaluationError,
  EvolutionTransitionError,
} from "../errors";
import type { EvolutionEvaluationPlan } from "../evaluation/types";
import {
  CancelledRunState,
  DatasetReadyRunState,
  EvaluatedRunState,
  type EvolutionDatasetManifest,
  type EvolutionEvaluationReport,
  EvolutionRun,
  OptimizingRunState,
} from "../model/index";
import {
  recordEvolutionDatasetMetric,
  recordEvolutionEvaluationMetric,
  recordEvolutionRunMetric,
} from "../observability/index";
import { transitionEvolutionRun } from "../state";
import type { EvolutionRunId } from "../types";
import { handleOptimizationResult } from "./optimization";
import { appendEvolutionRecord, evolutionTransitionContext } from "./support";
import type {
  EvolutionOptimizeInput,
  EvolutionOrchestratorDependencies,
} from "./types";

export const attachEvolutionDataset = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("attachEvolutionDataset")(function*(
    runId: EvolutionRunId,
    dataset: EvolutionDatasetManifest,
    now: string,
  ) {
    const run = yield* dependencies.runs.get(runId);
    if (dataset.targetDigest !== run.target.baselineDigest) {
      return yield* EvolutionDatasetError.make({
        operation: "attach-dataset",
        reason: "dataset target digest does not match the scoped run",
        caseIds: dataset.cases.map((item) => item.id),
      });
    }
    yield* validateEvolutionDatasetManifest(dataset);
    yield* dependencies.datasets.save(dataset);
    const updated = yield* transitionEvolutionRun(
      run,
      DatasetReadyRunState.make({
        datasetId: dataset.id,
        datasetDigest: dataset.digest,
      }),
      evolutionTransitionContext(run, now),
    );
    const stored = yield* dependencies.runs.save(EvolutionRun.make({
      ...updated,
      datasetId: dataset.id,
      datasetDigest: dataset.digest,
    }));
    yield* appendEvolutionRecord(dependencies, {
      run: stored,
      type: "evolution.dataset.sealed",
      payload: {
        datasetId: dataset.id,
        datasetDigest: dataset.digest,
        holdoutDigest: dataset.splitDigests.holdout,
      },
    });
    yield* recordEvolutionDatasetMetric({
      targetClass: stored.target.targetClass,
      dataset,
    });
    return stored;
  });

export const pauseEvolutionRun = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("pauseEvolutionRun")(function*(
    runId: EvolutionRunId,
    now: string,
  ) {
    const run = yield* dependencies.runs.get(runId);
    if (run.state._tag !== "optimizing") {
      return yield* EvolutionTransitionError.make({
        runId,
        from: run.state._tag,
        to: "optimizing",
      });
    }
    const resumeToken = yield* dependencies.engine.pause(runId);
    const paused = yield* transitionEvolutionRun(
      run,
      OptimizingRunState.make({ ...run.state, resumeToken }),
      evolutionTransitionContext(run, now),
    );
    return yield* dependencies.runs.save(paused);
  });

export const resumeEvolutionRun = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("resumeEvolutionRun")(function*(input: EvolutionOptimizeInput) {
    const run = yield* dependencies.runs.get(input.runId);
    if (
      run.state._tag !== "optimizing" || run.state.resumeToken === undefined
    ) {
      return yield* EvolutionTransitionError.make({
        runId: input.runId,
        from: run.state._tag,
        to: "optimizing",
      });
    }
    const result = yield* dependencies.engine.resume(run.state.resumeToken);
    return yield* handleOptimizationResult(
      {
        input,
        run,
        result,
      },
      dependencies,
    );
  });

export const evaluateEvolutionRun = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("evaluateEvolutionRun")(function*(plan: EvolutionEvaluationPlan) {
    const report = yield* dependencies.harness.evaluate(plan);
    return yield* recordEvolutionReport(dependencies)(report);
  });

export const recordEvolutionReport = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("recordEvolutionReport")(function*(
    report: EvolutionEvaluationReport,
  ) {
    const run = yield* dependencies.runs.get(report.runId);
    if (
      run.state._tag !== "shortlisted"
      || !run.state.candidateIds.includes(report.candidateId)
      || report.datasetDigest !== run.datasetDigest
      || report.baselineSnapshotId !== run.baselineSnapshotId
      || report.candidateSnapshotId === run.baselineSnapshotId
    ) {
      return yield* EvolutionEvaluationError.make({
        evaluatorRef: report.evaluatorRef,
        operation: "record-evaluation-binding",
        cause:
          "report must match a shortlisted candidate, sealed dataset, and distinct candidate Snapshot",
      });
    }
    yield* dependencies.reports.save(report);
    const updated = yield* transitionEvolutionRun(
      run,
      EvaluatedRunState.make({ reportId: report.id, passed: report.passed }),
      evolutionTransitionContext(run, report.createdAt),
    );
    yield* dependencies.runs.save(updated);
    yield* appendEvolutionRecord(dependencies, {
      run: updated,
      type: "evolution.evaluation.completed",
      payload: {
        reportId: report.id,
        candidateId: report.candidateId,
        passed: report.passed,
      },
    });
    yield* recordEvolutionEvaluationMetric({
      targetClass: updated.target.targetClass,
      report,
    });
    yield* recordEvolutionRunMetric(
      updated.target.targetClass,
      report.passed ? "evaluation-passed" : "evaluation-failed",
    );
    return report;
  });

export const cancelEvolutionRun = (
  dependencies: EvolutionOrchestratorDependencies,
) =>
  Effect.fn("cancelEvolutionRun")(function*(
    runId: EvolutionRunId,
    now: string,
    reason: string,
  ) {
    const run = yield* dependencies.runs.get(runId);
    yield* dependencies.engine.cancel(runId);
    const cancelled = yield* transitionEvolutionRun(
      run,
      CancelledRunState.make({ cancelledAt: now, reason }),
      evolutionTransitionContext(run, now),
    );
    const stored = yield* dependencies.runs.save(cancelled);
    yield* appendEvolutionRecord(dependencies, {
      run: stored,
      type: "evolution.run.cancelled",
      payload: { reason },
    });
    yield* recordEvolutionRunMetric(
      stored.target.targetClass,
      "cancelled",
    );
    return stored;
  });
