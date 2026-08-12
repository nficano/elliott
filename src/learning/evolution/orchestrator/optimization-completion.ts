import * as Effect from "effect/Effect";
import {
  evolutionCandidateFitness,
  paretoDominators,
  paretoEvolutionShortlist,
} from "../candidates/pareto";
import {
  BudgetExhaustedRunState,
  EvolutionBudgetUsage,
  type EvolutionCandidate,
  type EvolutionRun,
  EvolutionTransitionContext,
  RejectedRunState,
  ShortlistedRunState,
} from "../model/index";
import {
  recordEvolutionCandidateMetric,
  recordEvolutionRunMetric,
} from "../observability/index";
import { transitionEvolutionRun } from "../state";
import {
  appendEvolutionRecord,
  evolutionTransitionContext,
  noEvolutionUsage,
} from "./support";
import type {
  EvolutionExceededBudget,
  EvolutionOptimizationCompletion,
  EvolutionOrchestratorDependencies,
} from "./types";

const exceededBudget = (
  completion: EvolutionOptimizationCompletion,
): EvolutionExceededBudget | undefined => {
  const { candidates, run } = completion;
  const tokens = candidates.reduce(
    (total, candidate) =>
      total + candidate.usage.inputTokens + candidate.usage.outputTokens,
    0,
  );
  const cost = candidates.reduce(
    (total, candidate) => total + candidate.usage.costUsd,
    0,
  );
  const checks: readonly EvolutionExceededBudget[] = [
    {
      budget: "maximumCandidates",
      observed: candidates.length,
      limit: run.budgets.maximumCandidates,
    },
    {
      budget: "maximumTokens",
      observed: tokens,
      limit: run.budgets.maximumTokens,
    },
    {
      budget: "maximumCostUsd",
      observed: cost,
      limit: run.budgets.maximumCostUsd,
    },
  ];
  return checks.find((check) => check.observed > check.limit);
};

const optimizationUsage = (
  candidates: readonly EvolutionCandidate[],
): EvolutionBudgetUsage =>
  EvolutionBudgetUsage.make({
    ...noEvolutionUsage(),
    candidates: candidates.length,
    costUsd: candidates.reduce(
      (total, candidate) => total + candidate.usage.costUsd,
      0,
    ),
    tokens: candidates.reduce(
      (total, candidate) =>
        total + candidate.usage.inputTokens + candidate.usage.outputTokens,
      0,
    ),
  });

const optimizationNextState = (
  completion: EvolutionOptimizationCompletion,
  passing: readonly EvolutionCandidate[],
  exceeded: EvolutionExceededBudget | undefined,
) => {
  if (exceeded !== undefined) {
    return BudgetExhaustedRunState.make({
      exhaustedBudget: exceeded.budget,
      observed: exceeded.observed,
      limit: exceeded.limit,
    });
  }
  if (passing.length === 0) {
    return RejectedRunState.make({
      reason: "no candidate passed constraints",
    });
  }
  return ShortlistedRunState.make({
    candidateIds: passing.map((candidate) => candidate.id),
    sealedAt: completion.input.now,
  });
};

const optimizationRecordType = (
  exceeded: EvolutionExceededBudget | undefined,
  passingCount: number,
): string => {
  if (exceeded !== undefined) return "evolution.budget.exhausted";
  if (passingCount === 0) return "evolution.candidate.rejected";
  return "evolution.shortlist.sealed";
};

const recordRejectedCandidates = (
  input: {
    readonly dependencies: EvolutionOrchestratorDependencies;
    readonly run: EvolutionRun;
    readonly rejected: readonly EvolutionCandidate[];
    readonly eligible: readonly EvolutionCandidate[];
  },
) => {
  const { dependencies, eligible, rejected, run } = input;
  const eligibleIds = new Set(eligible.map((candidate) => candidate.id));
  return Effect.forEach(
    rejected,
    (candidate) =>
      appendEvolutionRecord(dependencies, {
        run,
        type: "evolution.candidate.rejected",
        payload: {
          candidateId: candidate.id,
          candidateDigest: candidate.candidateDigest,
          reason: eligibleIds.has(candidate.id)
            ? "pareto-dominated"
            : "constraint-failed",
          failedConstraints: candidate.constraints
            .filter((item) => !item.passed)
            .map((item) => item.constraint),
          dominatedBy: paretoDominators(candidate, eligible)
            .map((item) => item.id),
          fitness: evolutionCandidateFitness(candidate),
        },
      }),
    { concurrency: 1 },
  );
};

const recordCandidateMetrics = (
  input: {
    readonly run: EvolutionRun;
    readonly candidates: readonly EvolutionCandidate[];
    readonly passingIds: ReadonlySet<string>;
    readonly eligible: readonly EvolutionCandidate[];
  },
) =>
  Effect.forEach(
    input.candidates,
    (candidate) => {
      const passed = input.passingIds.has(candidate.id);
      return recordEvolutionCandidateMetric({
        targetClass: input.run.target.targetClass,
        candidate,
        outcome: passed ? "shortlisted" : "rejected",
        ...(!passed && {
          rejectionReason: input.eligible.includes(candidate)
            ? "pareto-dominated"
            : "constraint-failed",
        }),
      });
    },
    { discard: true },
  );

export const completeOptimization = Effect.fn(
  "completeEvolutionOptimization",
)(function*(
  completion: EvolutionOptimizationCompletion,
  dependencies: EvolutionOrchestratorDependencies,
) {
  const { candidates, input, run } = completion;
  const eligible = candidates.filter((candidate) =>
    candidate.constraints.length > 0
    && candidate.constraints.every((constraint) => constraint.passed)
  );
  const passing = paretoEvolutionShortlist(eligible);
  const passingIds = new Set(passing.map((candidate) => candidate.id));
  const rejected = candidates.filter((candidate) =>
    !passingIds.has(candidate.id)
  );
  yield* recordRejectedCandidates({
    dependencies,
    run,
    rejected,
    eligible,
  });
  yield* recordCandidateMetrics({ run, candidates, passingIds, eligible });
  const exceeded = exceededBudget(completion);
  const next = optimizationNextState(completion, passing, exceeded);
  const updated = yield* transitionEvolutionRun(
    run,
    next,
    EvolutionTransitionContext.make({
      ...evolutionTransitionContext(run, input.now),
      usage: optimizationUsage(candidates),
    }),
  );
  yield* dependencies.runs.save(updated);
  yield* appendEvolutionRecord(dependencies, {
    run: updated,
    type: optimizationRecordType(exceeded, passing.length),
    payload: {
      candidateIds: passing.map((candidate) => candidate.id),
      eligibleCandidateIds: eligible.map((candidate) => candidate.id),
      rejectedCandidateIds: rejected.map((candidate) => candidate.id),
      fitness: Object.fromEntries(
        candidates.map((candidate) => [
          candidate.id,
          evolutionCandidateFitness(candidate),
        ]),
      ),
    },
  });
  yield* recordEvolutionRunMetric(updated.target.targetClass, next._tag);
  return exceeded === undefined ? passing : [];
});
