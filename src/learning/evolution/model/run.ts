import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionEngineKindSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRiskClassSchema,
  EvolutionRunIdSchema,
  EvolutionTargetClassSchema,
} from "./identifiers";
import {
  NonNegativeFiniteSchema,
  NonNegativeIntSchema,
  PositiveFiniteSchema,
  PositiveIntSchema,
} from "./numeric";

export class EvolutionTarget extends Schema.Class<EvolutionTarget>(
  "EvolutionTarget",
)({
  targetClass: EvolutionTargetClassSchema,
  componentRef: Schema.String,
  baselineDigest: Schema.String,
  riskClass: EvolutionRiskClassSchema,
  mutationPath: Schema.optionalKey(Schema.String),
  allowedMutationPaths: Schema.Array(Schema.String),
  frozenPaths: Schema.Array(Schema.String),
}) {}

export class EvolutionBudgets extends Schema.Class<EvolutionBudgets>(
  "EvolutionBudgets",
)({
  maximumCandidates: PositiveIntSchema,
  maximumTokens: PositiveIntSchema,
  maximumCostUsd: PositiveFiniteSchema,
  maximumDurationMilliseconds: PositiveIntSchema,
  maximumConcurrency: PositiveIntSchema,
}) {}

export class EvolutionBudgetUsage extends Schema.Class<EvolutionBudgetUsage>(
  "EvolutionBudgetUsage",
)({
  candidates: NonNegativeIntSchema,
  tokens: NonNegativeIntSchema,
  costUsd: NonNegativeFiniteSchema,
  durationMilliseconds: NonNegativeIntSchema,
  concurrency: NonNegativeIntSchema,
}) {}

export class EvolutionTransitionContext
  extends Schema.Class<EvolutionTransitionContext>(
    "EvolutionTransitionContext",
  )({
    principalId: Schema.String,
    activeTargetDigest: Schema.String,
    now: Schema.String,
    usage: EvolutionBudgetUsage,
    capabilities: Schema.optionalKey(Schema.Array(Schema.String)),
  })
{}

export class DetectedRunState extends Schema.TaggedClass<DetectedRunState>()(
  "detected",
  { signalIds: Schema.Array(Schema.String) },
) {}

export class ScopedRunState extends Schema.TaggedClass<ScopedRunState>()(
  "scoped",
  { scopedAt: Schema.String },
) {}

export class DatasetReadyRunState
  extends Schema.TaggedClass<DatasetReadyRunState>()(
    "dataset-ready",
    {
      datasetId: EvolutionDatasetIdSchema,
      datasetDigest: Schema.String,
    },
  )
{}

export class OptimizingRunState
  extends Schema.TaggedClass<OptimizingRunState>()(
    "optimizing",
    {
      startedAt: Schema.String,
      candidateCount: Schema.Int,
      resumeToken: Schema.optionalKey(Schema.String),
    },
  )
{}

export class ShortlistedRunState
  extends Schema.TaggedClass<ShortlistedRunState>()(
    "shortlisted",
    {
      candidateIds: Schema.Array(EvolutionCandidateIdSchema),
      sealedAt: Schema.String,
    },
  )
{}

export class EvaluatedRunState extends Schema.TaggedClass<EvaluatedRunState>()(
  "evaluated",
  {
    reportId: EvolutionEvaluationReportIdSchema,
    passed: Schema.Boolean,
  },
) {}

export class ProposalAuthoredRunState
  extends Schema.TaggedClass<ProposalAuthoredRunState>()(
    "proposal-authored",
    {
      proposalId: Schema.String,
      candidateId: EvolutionCandidateIdSchema,
    },
  )
{}

export class AwaitingReviewRunState
  extends Schema.TaggedClass<AwaitingReviewRunState>()(
    "awaiting-review",
    { proposalId: Schema.String },
  )
{}

export class CanaryRunState extends Schema.TaggedClass<CanaryRunState>()(
  "canary",
  {
    releaseId: EvolutionReleaseIdSchema,
    candidateSnapshotId: Schema.String,
  },
) {}

export class PromotedRunState extends Schema.TaggedClass<PromotedRunState>()(
  "promoted",
  {
    releaseId: EvolutionReleaseIdSchema,
    promotedAt: Schema.String,
  },
) {}

export class RejectedRunState extends Schema.TaggedClass<RejectedRunState>()(
  "rejected",
  { reason: Schema.String },
) {}

export class StaleRunState extends Schema.TaggedClass<StaleRunState>()(
  "stale",
  {
    expectedDigest: Schema.String,
    activeDigest: Schema.String,
  },
) {}

export class CancelledRunState extends Schema.TaggedClass<CancelledRunState>()(
  "cancelled",
  {
    cancelledAt: Schema.String,
    reason: Schema.String,
  },
) {}

export class BudgetExhaustedRunState
  extends Schema.TaggedClass<BudgetExhaustedRunState>()(
    "budget-exhausted",
    {
      exhaustedBudget: Schema.String,
      observed: Schema.Number,
      limit: Schema.Number,
    },
  )
{}

export class FailedRunState extends Schema.TaggedClass<FailedRunState>()(
  "failed",
  {
    failedAt: Schema.String,
    errorTag: Schema.String,
    detail: Schema.String,
  },
) {}

export class RolledBackRunState
  extends Schema.TaggedClass<RolledBackRunState>()(
    "rolled-back",
    {
      releaseId: EvolutionReleaseIdSchema,
      rollbackReleaseId: EvolutionReleaseIdSchema,
      rolledBackAt: Schema.String,
    },
  )
{}

export const EvolutionRunStateSchema = Schema.Union([
  DetectedRunState,
  ScopedRunState,
  DatasetReadyRunState,
  OptimizingRunState,
  ShortlistedRunState,
  EvaluatedRunState,
  ProposalAuthoredRunState,
  AwaitingReviewRunState,
  CanaryRunState,
  PromotedRunState,
  RejectedRunState,
  StaleRunState,
  CancelledRunState,
  BudgetExhaustedRunState,
  FailedRunState,
  RolledBackRunState,
]);

export class EvolutionRun extends Schema.Class<EvolutionRun>("EvolutionRun")({
  id: EvolutionRunIdSchema,
  principalId: Schema.String,
  baselineSnapshotId: Schema.String,
  engineRef: Schema.String,
  engineKind: EvolutionEngineKindSchema,
  configurationDigest: Schema.String,
  signalIds: Schema.Array(Schema.String),
  datasetId: Schema.optionalKey(EvolutionDatasetIdSchema),
  datasetDigest: Schema.optionalKey(Schema.String),
  optimizationSeed: Schema.optionalKey(Schema.Int),
  target: EvolutionTarget,
  budgets: EvolutionBudgets,
  state: EvolutionRunStateSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}
