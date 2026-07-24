import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import type { EvolutionRun } from "../model/index";
import type {
  EvolutionCandidateMetricInput,
  EvolutionDatasetMetricInput,
  EvolutionEvaluationMetricInput,
} from "./types";

const runs = Metric.counter("elliott_evolution_runs_total");
const candidates = Metric.counter("elliott_evolution_candidates_total");
const rejectionReasons = Metric.counter(
  "elliott_evolution_candidate_rejections_total",
);
const fitnessDelta = Metric.gauge("elliott_evolution_fitness_delta");
const broadRegressionDelta = Metric.gauge(
  "elliott_evolution_broad_regression_delta",
);
const tokens = Metric.counter("elliott_evolution_tokens_total");
const cachedTokens = Metric.counter("elliott_evolution_cached_tokens_total");
const cost = Metric.counter("elliott_evolution_cost_usd_total");
const latency = Metric.histogram("elliott_evolution_latency_milliseconds", {
  boundaries: Metric.exponentialBoundaries({
    start: 1,
    factor: 2,
    count: 24,
  }),
});
const engineTime = Metric.histogram(
  "elliott_evolution_engine_milliseconds",
  {
    boundaries: Metric.exponentialBoundaries({
      start: 1,
      factor: 2,
      count: 24,
    }),
  },
);
const queueWait = Metric.histogram(
  "elliott_evolution_queue_wait_milliseconds",
  {
    boundaries: Metric.exponentialBoundaries({
      start: 1,
      factor: 2,
      count: 24,
    }),
  },
);
const activeDuration = Metric.histogram(
  "elliott_evolution_active_duration_milliseconds",
  {
    boundaries: Metric.exponentialBoundaries({
      start: 1,
      factor: 2,
      count: 24,
    }),
  },
);
const proposals = Metric.counter("elliott_evolution_proposals_total");
const canaries = Metric.counter("elliott_evolution_canary_outcomes_total");
const toolConfusion = Metric.counter(
  "elliott_evolution_tool_confusion_total",
);
const datasetCases = Metric.counter("elliott_evolution_dataset_cases_total");
const monthlyBudget = Metric.gauge(
  "elliott_evolution_monthly_budget_consumption_usd",
);

const tagged = <Input, State>(
  metric: Metric.Metric<Input, State>,
  attributes: Readonly<Record<string, string>>,
) => metric.pipe(Metric.withAttributes(attributes));

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

export const recordEvolutionRunMetric = (
  targetClass: EvolutionRun["target"]["targetClass"],
  outcome: string,
) => Metric.update(tagged(runs, { target_class: targetClass, outcome }), 1);

export const recordEvolutionCandidateMetric = (
  input: EvolutionCandidateMetricInput,
) =>
  Effect.all([
    Metric.update(
      tagged(candidates, {
        target_class: input.targetClass,
        outcome: input.outcome,
      }),
      1,
    ),
    Metric.update(
      tagged(tokens, {
        target_class: input.targetClass,
        kind: "input",
      }),
      input.candidate.usage.inputTokens,
    ),
    Metric.update(
      tagged(tokens, {
        target_class: input.targetClass,
        kind: "output",
      }),
      input.candidate.usage.outputTokens,
    ),
    Metric.update(
      tagged(cost, { target_class: input.targetClass }),
      input.candidate.usage.costUsd,
    ),
    Metric.update(
      tagged(latency, { target_class: input.targetClass }),
      input.candidate.usage.latencyMilliseconds,
    ),
    Metric.update(
      tagged(engineTime, { target_class: input.targetClass }),
      input.candidate.usage.latencyMilliseconds,
    ),
    ...(input.rejectionReason === undefined
      ? []
      : [
        Metric.update(
          tagged(rejectionReasons, {
            target_class: input.targetClass,
            reason: input.rejectionReason,
          }),
          1,
        ),
      ]),
  ], { discard: true });

export const recordEvolutionEvaluationMetric = (
  input: EvolutionEvaluationMetricInput,
) => {
  const holdout = input.report.metrics.filter((item) =>
    item.split === "holdout"
  );
  const benchmarkDeltas = input.report.benchmarks
    .filter((item) => item.status !== "not-applicable")
    .map((item) => item.candidateScore - item.baselineScore);
  return Effect.all([
    Metric.update(
      tagged(fitnessDelta, { target_class: input.targetClass }),
      average(holdout.map((item) => item.delta)),
    ),
    Metric.update(
      tagged(broadRegressionDelta, { target_class: input.targetClass }),
      average(benchmarkDeltas),
    ),
    Metric.update(
      tagged(cost, { target_class: input.targetClass }),
      input.report.totalCostUsd,
    ),
    Metric.update(
      tagged(latency, { target_class: input.targetClass }),
      input.report.totalLatencyMilliseconds,
    ),
  ], { discard: true });
};

export const recordEvolutionDatasetMetric = (
  input: EvolutionDatasetMetricInput,
) =>
  Effect.forEach(
    input.dataset.cases,
    (evaluationCase) =>
      Metric.update(
        tagged(datasetCases, {
          target_class: input.targetClass,
          classification: evaluationCase.classification,
          source: input.dataset.sources.find((source) =>
            evaluationCase.sourceDigests.includes(source.digest)
          )?.kind ?? "unknown",
        }),
        1,
      ),
    { discard: true },
  );

export const recordEvolutionProposalMetric = (
  targetClass: string,
  decision: "authored" | "approved" | "rejected",
) =>
  Metric.update(
    tagged(proposals, {
      target_class: targetClass,
      decision,
    }),
    1,
  );

export const recordEvolutionCanaryMetric = (
  targetClass: string,
  outcome: "passed" | "failed" | "rolled-back",
) =>
  Metric.update(
    tagged(canaries, {
      target_class: targetClass,
      outcome,
    }),
    1,
  );

export const recordEvolutionToolConfusionMetric = (
  requested: string,
  selected: string,
) => Metric.update(tagged(toolConfusion, { requested, selected }), 1);

export const recordEvolutionQueueMetric = (
  waitMilliseconds: number,
  activeMilliseconds: number,
) =>
  Effect.all([
    Metric.update(queueWait, waitMilliseconds),
    Metric.update(activeDuration, activeMilliseconds),
  ], { discard: true });

export const recordEvolutionCachedTokensMetric = (
  targetClass: string,
  value: number,
) => Metric.update(tagged(cachedTokens, { target_class: targetClass }), value);

export const recordEvolutionMonthlyBudgetMetric = (
  month: string,
  spentUsd: number,
) => Metric.update(tagged(monthlyBudget, { month }), spentUsd);

export const evolutionMetricSnapshot = Metric.snapshot.pipe(
  Effect.map((snapshot) =>
    snapshot.filter((item) => item.id.startsWith("elliott_evolution_"))
  ),
);
