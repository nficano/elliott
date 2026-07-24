import * as Effect from "effect/Effect";
import {
  CanaryRunState,
  EvolutionBudgetUsage,
  EvolutionRelease,
  EvolutionRun,
  EvolutionTransitionContext,
  FailedRunState,
  PromotedRunState,
} from "../model/index";
import { transitionEvolutionRun } from "../state";
import type { EvolutionPromotionInput, EvolutionReleaseStores } from "./types";

const promotionContext = (input: EvolutionPromotionInput) =>
  EvolutionTransitionContext.make({
    principalId: input.promoterId,
    activeTargetDigest: input.activeTargetDigest,
    now: input.now,
    capabilities: input.promoterCapabilities,
    usage: EvolutionBudgetUsage.make({
      candidates: 0,
      tokens: 0,
      costUsd: 0,
      durationMilliseconds: 0,
      concurrency: 0,
    }),
  });

export const saveCanaryRun = Effect.fn("saveEvolutionCanaryRun")(function*(
  input: EvolutionPromotionInput,
  stores: EvolutionReleaseStores,
  release: EvolutionRelease,
) {
  const canary = yield* transitionEvolutionRun(
    input.run,
    CanaryRunState.make({
      releaseId: release.id,
      candidateSnapshotId: release.snapshotId,
    }),
    promotionContext(input),
  );
  yield* stores.runs.save(canary);
  return canary;
});

export const saveFailedCanaryRun = Effect.fn(
  "saveFailedEvolutionCanaryRun",
)(function*(
  input: EvolutionPromotionInput,
  stores: EvolutionReleaseStores,
  canary: EvolutionRun,
) {
  const failed = yield* transitionEvolutionRun(
    canary,
    FailedRunState.make({
      failedAt: input.now,
      errorTag: "canary-failed",
      detail: "candidate never entered active state",
    }),
    EvolutionTransitionContext.make({
      ...promotionContext(input),
      principalId: input.run.principalId,
    }),
  );
  yield* stores.runs.save(failed);
});

export const savePromotedRun = Effect.fn("savePromotedEvolutionRun")(function*(
  input: EvolutionPromotionInput,
  stores: EvolutionReleaseStores,
  release: EvolutionRelease,
) {
  const canary = yield* stores.runs.get(input.run.id);
  const promoted = yield* transitionEvolutionRun(
    canary,
    PromotedRunState.make({
      releaseId: release.id,
      promotedAt: input.now,
    }),
    promotionContext(input),
  );
  yield* stores.runs.save(promoted);
});
