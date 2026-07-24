import type { EvolutionSignal } from "../model/index";
import type { EvolutionTriageInput, EvolutionTriageResult } from "./types";

const C1_RANK = 1;
const C2_RANK = 2;
const C3_RANK = 3;
const C4_RANK = 4;

const riskRank = new Map([
  ["C1", C1_RANK],
  ["C2", C2_RANK],
  ["C3", C3_RANK],
  ["C4", C4_RANK],
]);

export const evolutionTriageScore = (signal: EvolutionSignal): number =>
  (
    signal.strength * signal.usageFrequency * signal.expectedImpact
    * signal.evaluatorConfidence
  ) / Math.max(Number.EPSILON, signal.estimatedCost);

export const triageEvolutionSignals = (
  input: EvolutionTriageInput,
): EvolutionTriageResult => {
  if (input.activeRunCount >= input.maximumConcurrentRuns) {
    return { reason: "concurrency-exhausted" };
  }
  if (input.monthlySpentUsd >= input.monthlyBudgetUsd) {
    return { reason: "monthly-budget-exhausted" };
  }
  const maximumRisk = riskRank.get(input.maximumRiskClass) ?? 0;
  const selected = input.signals
    .filter((signal) =>
      !input.cooldownTargetRefs.has(signal.targetRef)
      && !input.activeTargetRefs.has(signal.targetRef)
      && (riskRank.get(signal.riskClass) ?? Infinity) <= maximumRisk
      && !(signal.source === "model-reflection"
        && (signal.riskClass === "C3" || signal.riskClass === "C4"))
    )
    .map((signal) => ({ signal, score: evolutionTriageScore(signal) }))
    .toSorted((left, right) =>
      right.score - left.score
      || left.signal.targetRef.localeCompare(right.signal.targetRef)
    )[0];
  return selected === undefined
    ? { reason: "no-eligible-signal" }
    : {
      selected: selected.signal,
      score: selected.score,
      reason: "selected",
    };
};
