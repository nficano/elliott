import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  evolutionMetricSnapshot,
  recordEvolutionCachedTokensMetric,
  recordEvolutionCanaryMetric,
  recordEvolutionCandidateMetric,
  recordEvolutionDatasetMetric,
  recordEvolutionEvaluationMetric,
  recordEvolutionMonthlyBudgetMetric,
  recordEvolutionProposalMetric,
  recordEvolutionQueueMetric,
  recordEvolutionRunMetric,
  recordEvolutionToolConfusionMetric,
} from "../../../src/learning/evolution/observability/index";
import { makeCandidate } from "./helpers";

describe("evolution observability", () => {
  it("exports every plan-required metric family without content fields", async () => {
    const candidate = makeCandidate();
    await Effect.runPromise(Effect.all([
      recordEvolutionRunMetric("skill", "shortlisted"),
      recordEvolutionCandidateMetric({
        targetClass: "skill",
        candidate,
        outcome: "rejected",
        rejectionReason: "constraint-failed",
      }),
      recordEvolutionEvaluationMetric({
        targetClass: "skill",
        report: {
          metrics: [{
            split: "holdout",
            delta: 0.1,
          }],
          benchmarks: [{
            status: "passed",
            baselineScore: 0.5,
            candidateScore: 0.6,
          }],
          totalCostUsd: 0.1,
          totalLatencyMilliseconds: 10,
        } as never,
      }),
      recordEvolutionDatasetMetric({
        targetClass: "skill",
        dataset: {
          sources: [{
            digest: "sha256:source",
            kind: "golden",
          }],
          cases: [{
            classification: "internal",
            sourceDigests: ["sha256:source"],
          }],
        } as never,
      }),
      recordEvolutionProposalMetric("skill", "approved"),
      recordEvolutionCanaryMetric("skill", "rolled-back"),
      recordEvolutionToolConfusionMetric("search", "lookup"),
      recordEvolutionQueueMetric(5, 10),
      recordEvolutionCachedTokensMetric("skill", 0),
      recordEvolutionMonthlyBudgetMetric("2026-07", 1),
    ], { discard: true }));
    const names = new Set(
      (await Effect.runPromise(evolutionMetricSnapshot))
        .map((item) => item.id),
    );
    expect(names).toEqual(
      new Set([
        "elliott_evolution_active_duration_milliseconds",
        "elliott_evolution_broad_regression_delta",
        "elliott_evolution_cached_tokens_total",
        "elliott_evolution_candidate_rejections_total",
        "elliott_evolution_candidates_total",
        "elliott_evolution_canary_outcomes_total",
        "elliott_evolution_cost_usd_total",
        "elliott_evolution_dataset_cases_total",
        "elliott_evolution_engine_milliseconds",
        "elliott_evolution_fitness_delta",
        "elliott_evolution_latency_milliseconds",
        "elliott_evolution_monthly_budget_consumption_usd",
        "elliott_evolution_proposals_total",
        "elliott_evolution_queue_wait_milliseconds",
        "elliott_evolution_runs_total",
        "elliott_evolution_tokens_total",
        "elliott_evolution_tool_confusion_total",
      ]),
    );
  });
});
