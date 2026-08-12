import * as Effect from "effect/Effect";
import {
  EvolutionAuthorityError,
  EvolutionBudgetError,
  EvolutionStaleTargetError,
  EvolutionTransitionError,
} from "./errors";
import { EvolutionRun, type EvolutionTransitionContext } from "./model/index";
import type { EvolutionRunState, EvolutionWorkflowError } from "./types";

const terminalStates = new Set([
  "rejected",
  "stale",
  "cancelled",
  "budget-exhausted",
  "failed",
  "rolled-back",
]);

const transitionTargets = new Map<string, ReadonlySet<string>>([
  ["detected", new Set(["scoped", "cancelled", "failed"])],
  ["scoped", new Set(["dataset-ready", "stale", "cancelled", "failed"])],
  [
    "dataset-ready",
    new Set(["optimizing", "stale", "cancelled", "failed"]),
  ],
  [
    "optimizing",
    new Set([
      "shortlisted",
      "optimizing",
      "rejected",
      "budget-exhausted",
      "cancelled",
      "failed",
      "stale",
    ]),
  ],
  ["shortlisted", new Set(["evaluated", "rejected", "stale", "failed"])],
  [
    "evaluated",
    new Set(["proposal-authored", "rejected", "stale", "failed"]),
  ],
  [
    "proposal-authored",
    new Set(["awaiting-review", "rejected", "stale", "failed"]),
  ],
  [
    "awaiting-review",
    new Set(["canary", "rejected", "stale", "failed"]),
  ],
  ["canary", new Set(["promoted", "rolled-back", "failed"])],
  ["promoted", new Set(["rolled-back"])],
]);

const checkBudget = (
  run: EvolutionRun,
  context: EvolutionTransitionContext,
) => {
  const checks = [
    [
      "maximumCandidates",
      context.usage.candidates,
      run.budgets.maximumCandidates,
    ],
    ["maximumTokens", context.usage.tokens, run.budgets.maximumTokens],
    ["maximumCostUsd", context.usage.costUsd, run.budgets.maximumCostUsd],
    [
      "maximumDurationMilliseconds",
      context.usage.durationMilliseconds,
      run.budgets.maximumDurationMilliseconds,
    ],
    [
      "maximumConcurrency",
      context.usage.concurrency,
      run.budgets.maximumConcurrency,
    ],
  ] as const;
  const exceeded = checks.find(([, observed, limit]) => observed > limit);
  return exceeded === undefined
    ? Effect.void
    : EvolutionBudgetError.make({
      budget: exceeded[0],
      observed: exceeded[1],
      limit: exceeded[2],
    });
};

const releaseCapability = (
  next: EvolutionRunState,
): "release.promote" | "release.rollback" | undefined => {
  if (next._tag === "canary" || next._tag === "promoted") {
    return "release.promote";
  }
  if (next._tag === "rolled-back") return "release.rollback";
  return undefined;
};

const transitionAuthorized = (
  run: EvolutionRun,
  next: EvolutionRunState,
  context: EvolutionTransitionContext,
): boolean => {
  const required = releaseCapability(next);
  if (required === undefined) return context.principalId === run.principalId;
  return context.principalId !== run.principalId
    && context.capabilities?.includes(required) === true;
};

export const transitionEvolutionRun = Effect.fn("transitionEvolutionRun")(
  function*(
    run: EvolutionRun,
    next: EvolutionRunState,
    context: EvolutionTransitionContext,
  ): Effect.fn.Return<EvolutionRun, EvolutionWorkflowError> {
    if (terminalStates.has(run.state._tag)) {
      return yield* EvolutionTransitionError.make({
        runId: run.id,
        from: run.state._tag,
        to: next._tag,
      });
    }
    if (!transitionAuthorized(run, next, context)) {
      return yield* EvolutionAuthorityError.make({
        principalId: context.principalId,
        action: "transition-evolution-run",
        reason: `transition ${next._tag} lacks separated release authority`,
      });
    }
    if (
      next._tag !== "promoted" && next._tag !== "rolled-back"
      && context.activeTargetDigest !== run.target.baselineDigest
    ) {
      return yield* EvolutionStaleTargetError.make({
        targetRef: run.target.componentRef,
        expectedDigest: run.target.baselineDigest,
        activeDigest: context.activeTargetDigest,
      });
    }
    if (next._tag !== "budget-exhausted") yield* checkBudget(run, context);
    if (!transitionTargets.get(run.state._tag)?.has(next._tag)) {
      return yield* EvolutionTransitionError.make({
        runId: run.id,
        from: run.state._tag,
        to: next._tag,
      });
    }
    return EvolutionRun.make({ ...run, state: next, updatedAt: context.now });
  },
);
