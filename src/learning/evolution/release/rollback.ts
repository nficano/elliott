import * as Effect from "effect/Effect";
import { EvolutionAuthorityError, EvolutionStaleTargetError } from "../errors";
import {
  EvolutionBudgetUsage,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
  EvolutionTransitionContext,
  RolledBackRunState,
} from "../model/index";
import { recordEvolutionCanaryMetric } from "../observability/index";
import { transitionEvolutionRun } from "../state";
import type {
  EvolutionPromotionActivation,
  EvolutionReleaseHooks,
  EvolutionReleaseStores,
  EvolutionRollbackInput,
} from "./types";

const assertRollbackEligible = Effect.fn("assertEvolutionRollbackEligible")(
  function*(input: EvolutionRollbackInput) {
    if (!input.capabilities.includes("release.rollback")) {
      return yield* EvolutionAuthorityError.make({
        principalId: input.principalId,
        action: "rollback-evolution-release",
        reason: "release.rollback capability is required",
      });
    }
    if (input.activeTargetDigest !== input.release.targetDigest) {
      return yield* EvolutionStaleTargetError.make({
        targetRef: input.release.targetRef,
        expectedDigest: input.release.targetDigest,
        activeDigest: input.activeTargetDigest,
      });
    }
  },
);

const rollbackReleaseFrom = (
  input: EvolutionRollbackInput,
  activation: EvolutionPromotionActivation,
): EvolutionRelease =>
  EvolutionRelease.make({
    ...input.release,
    id: EvolutionReleaseIdSchema.make(`evl_${crypto.randomUUID()}`),
    previousReleaseId: input.release.id,
    targetDigest: input.release.rollback.previousTargetDigest,
    revisionDigest: activation.revisionDigest,
    snapshotId: activation.snapshotId,
    auditCrossLinkDigest: activation.auditCrossLinkDigest,
    rollback: EvolutionRollbackMetadata.make({
      previousTargetDigest: input.release.targetDigest,
      previousRevisionDigest: input.release.revisionDigest,
      previousSnapshotId: input.release.snapshotId,
      candidateRevisionDigest: activation.revisionDigest,
      candidateSnapshotId: activation.snapshotId,
    }),
    promotedBy: input.principalId,
    promotedAt: input.now,
    status: "active",
  });

const saveRolledBackRun = Effect.fn("saveRolledBackEvolutionRun")(function*(
  input: EvolutionRollbackInput,
  stores: EvolutionReleaseStores,
  rollbackRelease: EvolutionRelease,
) {
  const run = yield* stores.runs.get(input.release.runId);
  const rolledBack = yield* transitionEvolutionRun(
    run,
    RolledBackRunState.make({
      releaseId: input.release.id,
      rollbackReleaseId: rollbackRelease.id,
      rolledBackAt: input.now,
    }),
    EvolutionTransitionContext.make({
      principalId: input.principalId,
      activeTargetDigest: input.activeTargetDigest,
      now: input.now,
      capabilities: input.capabilities,
      usage: EvolutionBudgetUsage.make({
        candidates: 0,
        tokens: 0,
        costUsd: 0,
        durationMilliseconds: 0,
        concurrency: 0,
      }),
    }),
  );
  yield* stores.runs.save(rolledBack);
});

export const rollbackEvolutionRelease = Effect.fn("rollbackEvolutionRelease")(
  function*(
    input: EvolutionRollbackInput,
    hooks: EvolutionReleaseHooks,
    stores: EvolutionReleaseStores,
  ) {
    yield* assertRollbackEligible(input);
    yield* hooks.recordRollbackIntent(input.release, input.principalId);
    const activation = yield* hooks.activatePriorRevision(input.release);
    const rollbackRelease = rollbackReleaseFrom(input, activation);
    yield* stores.releases.save(rollbackRelease);
    yield* hooks.recordRolledBack(rollbackRelease);
    const run = yield* stores.runs.get(input.release.runId);
    yield* recordEvolutionCanaryMetric(
      run.target.targetClass,
      "rolled-back",
    );
    yield* saveRolledBackRun(input, stores, rollbackRelease);
    return rollbackRelease;
  },
);
