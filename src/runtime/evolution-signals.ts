/* eslint-disable max-lines-per-function */
import { hashValue } from "../core/digest";
import { evolutionSignalFromToolFailure } from "../learning/evolution/continuous/signals";
import { triageEvolutionSignals } from "../learning/evolution/continuous/triage";
import { EvolutionSignal } from "../learning/evolution/model/index";
import type {
  EvolutionPerformanceProjection,
  EvolutionTarget,
} from "../learning/evolution/model/index";
import type {
  FeedbackEvidence,
  ToolFailureEvidenceSummary,
} from "../memory/types";

const MINIMUM_COST_USD = 0.01;
const CONFIDENCE_SAMPLE_COUNT = 10;
const CONFIRMED_FAILURE_STRENGTH = 0.8;

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

const projectionSignal = (
  projection: EvolutionPerformanceProjection,
  target: EvolutionTarget,
): EvolutionSignal | undefined => {
  if (projection.targetDigest !== target.baselineDigest) return undefined;
  const weakness = Math.max(
    clampUnit(1 - projection.successRate),
    clampUnit(projection.correctionRate),
    clampUnit(1 - projection.benchmarkScore),
  );
  if (weakness === 0) return undefined;
  return EvolutionSignal.make({
    id: `projection-${hashValue(projection)}`,
    targetRef: target.componentRef,
    targetClass: target.targetClass,
    riskClass: target.riskClass,
    strength: weakness,
    usageFrequency: Math.max(1, projection.sampleCount),
    expectedImpact: weakness,
    evaluatorConfidence: clampUnit(
      projection.sampleCount / CONFIDENCE_SAMPLE_COUNT,
    ),
    estimatedCost: Math.max(
      MINIMUM_COST_USD,
      projection.averageCostUsd,
    ),
    source: "benchmark",
    createdAt: projection.projectedAt,
  });
};

const feedbackSignals = (
  target: EvolutionTarget,
  feedback: readonly FeedbackEvidence[],
  estimatedCost: number,
): readonly EvolutionSignal[] => {
  const failures = feedback.filter((item) =>
    item.kind === "confirmed-failure"
    || item.kind === "explicit-correction"
  );
  return failures.map((item) =>
    EvolutionSignal.make({
      id: `feedback-${item.id}`,
      targetRef: target.componentRef,
      targetClass: target.targetClass,
      riskClass: target.riskClass,
      strength: item.kind === "explicit-correction"
        ? 1
        : CONFIRMED_FAILURE_STRENGTH,
      usageFrequency: Math.max(1, feedback.length),
      expectedImpact: failures.length / Math.max(1, feedback.length),
      evaluatorConfidence: 1,
      estimatedCost: Math.max(MINIMUM_COST_USD, estimatedCost),
      source: "explicit-feedback",
      createdAt: item.createdAt,
    })
  );
};

const toolFailureSignals = (
  target: EvolutionTarget,
  summary: ToolFailureEvidenceSummary,
  estimatedCost: number,
): readonly EvolutionSignal[] => {
  if (target.targetClass !== "tool-description") return [];
  const impact = summary.failures.length / Math.max(1, summary.totalCalls);
  return summary.failures.map((toolCall) => {
    const signal = evolutionSignalFromToolFailure({
      toolCall,
      targetRef: target.componentRef,
      riskClass: target.riskClass,
      usageFrequency: Math.max(1, summary.totalCalls),
      expectedImpact: impact,
      estimatedCost: Math.max(MINIMUM_COST_USD, estimatedCost),
      classification: "internal",
    });
    return EvolutionSignal.make({
      id: `tool-failure-${signal.id}`,
      targetRef: signal.targetRef,
      targetClass: signal.targetClass,
      riskClass: signal.riskClass,
      strength: signal.strength,
      usageFrequency: signal.usageFrequency,
      expectedImpact: signal.expectedImpact,
      evaluatorConfidence: signal.evaluatorConfidence,
      estimatedCost: signal.estimatedCost,
      source: signal.source,
      createdAt: signal.createdAt,
    });
  });
};

export const selectRuntimeEvolutionSignal = (input: {
  readonly targets: readonly EvolutionTarget[];
  readonly projections: readonly EvolutionPerformanceProjection[];
  readonly feedbackByTarget: ReadonlyMap<
    string,
    readonly FeedbackEvidence[]
  >;
  readonly toolFailuresByTarget?: ReadonlyMap<
    string,
    ToolFailureEvidenceSummary
  >;
  readonly cooldownTargetRefs?: ReadonlySet<string>;
  readonly activeTargetRefs: ReadonlySet<string>;
  readonly activeRunCount: number;
  readonly maximumConcurrentRuns: number;
  readonly monthlySpentUsd: number;
  readonly monthlyBudgetUsd: number;
  readonly maximumRiskClass: EvolutionTarget["riskClass"];
  readonly estimatedCampaignCostUsd: number;
}) => {
  const targets = new Map(
    input.targets.map((target) => [target.componentRef, target]),
  );
  const signals = [
    ...input.projections.flatMap((projection) => {
      const target = targets.get(projection.targetRef);
      if (target === undefined) return [];
      const signal = projectionSignal(projection, target);
      return signal === undefined ? [] : [signal];
    }),
    ...input.targets.flatMap((target) =>
      feedbackSignals(
        target,
        input.feedbackByTarget.get(target.componentRef) ?? [],
        input.estimatedCampaignCostUsd,
      )
    ),
    ...input.targets.flatMap((target) =>
      toolFailureSignals(
        target,
        input.toolFailuresByTarget?.get(target.componentRef) ?? {
          failures: [],
          totalCalls: 0,
        },
        input.estimatedCampaignCostUsd,
      )
    ),
  ];
  return triageEvolutionSignals({
    signals,
    cooldownTargetRefs: input.cooldownTargetRefs ?? new Set(),
    activeTargetRefs: input.activeTargetRefs,
    activeRunCount: input.activeRunCount,
    maximumConcurrentRuns: input.maximumConcurrentRuns,
    monthlySpentUsd: input.monthlySpentUsd,
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    maximumRiskClass: input.maximumRiskClass,
  });
};
