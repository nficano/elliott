import type { Effect } from "effect";
import type { Option } from "effect/Option";
import type { SnapshotStore } from "../../../core/snapshot/snapshot";
import type { RecordAppender } from "../../../core/waist/types";
import type { FootprintBudget } from "../../../observability/types";
import type { EvolutionTargetCatalogShape } from "../application/types";
import type {
  EvolutionBaselineControllerShape,
  EvolutionIndependentEvaluatorShape,
} from "../application/types";
import type { EvolutionBenchmarkStage } from "../benchmarks/types";
import type {
  EvolutionBaselineReport,
  EvolutionBenchmarkResult,
  EvolutionCandidate,
  EvolutionCaseResult,
  EvolutionDatasetCase,
  EvolutionDatasetManifest,
  EvolutionEvaluationReport,
  EvolutionFootprintResult,
  EvolutionMetricDefinition,
  EvolutionMetricResult,
  EvolutionRun,
  EvolutionStatisticalComparison,
} from "../model/index";
import type { EvolutionBaselineReportStoreShape } from "../types";
import type { EvolutionWorkflowError } from "../types";

export interface EvolutionStatisticsInput {
  readonly baseline: readonly number[];
  readonly candidate: readonly number[];
  readonly confidenceLevel: number;
  readonly iterations: number;
  readonly seed: number;
  readonly regressionFloor: number;
  readonly multipleComparisonCount: number;
}

export interface EvolutionFitnessInput {
  readonly definitions: readonly EvolutionMetricDefinition[];
  readonly baseline: readonly EvolutionCaseResult[];
  readonly candidate: readonly EvolutionCaseResult[];
}

export interface EvolutionFitnessResult {
  readonly metrics: readonly EvolutionMetricResult[];
  readonly weightedDelta: number;
  readonly passed: boolean;
}

export interface EvolutionCaseExecutor {
  readonly execute: (
    snapshotId: string,
    evaluationCase: EvolutionDatasetCase,
    seed: number,
  ) => Effect.Effect<EvolutionCaseResult, EvolutionWorkflowError>;
}

export interface HttpIndependentEvaluatorConfig {
  readonly endpoint: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface RuntimeEvaluationRequestFactoryInput {
  readonly snapshots: SnapshotStore;
  readonly targets: EvolutionTargetCatalogShape;
  readonly evaluatorRef: string;
  readonly authoringRouteDigest?: string;
  readonly evaluationRouteDigest?: string;
  readonly environmentDigest: string;
}

export interface EvolutionEvaluationPlan {
  readonly run: EvolutionRun;
  readonly candidate: EvolutionCandidate;
  readonly dataset: EvolutionDatasetManifest;
  readonly baselineSnapshotId: string;
  readonly candidateSnapshotId: string;
  readonly evaluatorRef: string;
  readonly authoringRouteDigest: string;
  readonly evaluationRouteDigest: string;
  readonly evaluationPlanDigest: string;
  readonly environmentDigest: string;
  readonly seed: number;
  readonly metrics: readonly EvolutionMetricDefinition[];
  readonly confidenceLevel: number;
  readonly bootstrapIterations: number;
  readonly multipleComparisonCount: number;
  readonly requiredConstraints: readonly string[];
  readonly benchmarkStages: readonly EvolutionBenchmarkStage[];
  readonly footprints: readonly EvolutionFootprintResult[];
}

export interface EvolutionHarnessShape {
  readonly evaluate: (
    plan: EvolutionEvaluationPlan,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionWorkflowError>;
}

export interface EvolutionReportBuildInput {
  readonly plan: EvolutionEvaluationPlan;
  readonly baselineCases: readonly EvolutionCaseResult[];
  readonly candidateCases: readonly EvolutionCaseResult[];
  readonly fitness: EvolutionFitnessResult;
  readonly comparison: EvolutionStatisticalComparison;
  readonly benchmarks: readonly EvolutionBenchmarkResult[];
}

export interface EvolutionEvaluationCacheShape {
  readonly get: (
    key: string,
  ) => Effect.Effect<Option<EvolutionEvaluationReport>, EvolutionWorkflowError>;
  readonly put: (
    key: string,
    report: EvolutionEvaluationReport,
  ) => Effect.Effect<void, EvolutionWorkflowError>;
}

export interface EvolutionBaselineCacheShape {
  readonly get: (
    key: string,
  ) => Effect.Effect<Option<EvolutionBaselineReport>, EvolutionWorkflowError>;
  readonly put: (
    key: string,
    report: EvolutionBaselineReport,
  ) => Effect.Effect<void, EvolutionWorkflowError>;
}

export interface RuntimeBaselineControllerInput {
  readonly evaluator: EvolutionIndependentEvaluatorShape;
  readonly reports: EvolutionBaselineReportStoreShape;
  readonly records: RecordAppender;
  readonly evaluatorRef: string;
  readonly authoringRouteDigest?: string;
  readonly evaluationRouteDigest?: string;
  readonly environmentDigest: string;
}

export type RuntimeBaselineController = EvolutionBaselineControllerShape;

export interface EvolutionFootprintBudget extends FootprintBudget {
  readonly category: "prompt" | "inference" | "runtime";
}
