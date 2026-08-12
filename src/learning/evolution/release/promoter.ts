import * as Effect from "effect/Effect";
import { proposalApprovers } from "../../proposals/reviews";
import {
  EvolutionAuthorityError,
  EvolutionPromotionError,
  EvolutionStaleTargetError,
} from "../errors";
import {
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
} from "../model/index";
import { recordEvolutionCanaryMetric } from "../observability/index";
import { promotionEvidenceFailure } from "./evidence";
import {
  saveCanaryRun,
  saveFailedCanaryRun,
  savePromotedRun,
} from "./run-state";
import type {
  EvolutionPreparedRelease,
  EvolutionPromotionActivation,
  EvolutionPromotionInput,
  EvolutionReleaseHooks,
  EvolutionReleaseStores,
} from "./types";

const hasSeparatedPrincipals = (input: EvolutionPromotionInput): boolean =>
  input.promoterId !== input.proposal.author
  && !proposalApprovers(input.proposal).includes(input.promoterId);

const assertPromotionEligible = Effect.fn(
  "assertEvolutionPromotionEligible",
)(function*(input: EvolutionPromotionInput) {
  const evidenceFailure = promotionEvidenceFailure(input);
  if (evidenceFailure !== undefined) {
    return yield* EvolutionPromotionError.make({
      proposalId: input.proposal.id,
      stage: "eligibility",
      reason: evidenceFailure,
    });
  }
  if (!hasSeparatedPrincipals(input)) {
    return yield* EvolutionAuthorityError.make({
      principalId: input.promoterId,
      action: "promote-evolution-release",
      reason: "author, approver, and promoter must be distinct",
    });
  }
  if (!input.promoterCapabilities.includes("release.promote")) {
    return yield* EvolutionAuthorityError.make({
      principalId: input.promoterId,
      action: "promote-evolution-release",
      reason: "release.promote capability is required",
    });
  }
  if (input.activeTargetDigest !== input.run.target.baselineDigest) {
    return yield* EvolutionStaleTargetError.make({
      targetRef: input.run.target.componentRef,
      expectedDigest: input.run.target.baselineDigest,
      activeDigest: input.activeTargetDigest,
    });
  }
});

const releaseFromActivation = (
  input: EvolutionPromotionInput,
  activation: EvolutionPreparedRelease,
  status: EvolutionRelease["status"],
): EvolutionRelease =>
  EvolutionRelease.make({
    id: EvolutionReleaseIdSchema.make(`evl_${crypto.randomUUID()}`),
    runId: input.run.id,
    proposalId: input.proposal.id,
    candidateId: input.candidate.id,
    targetRef: input.run.target.componentRef,
    targetDigest: input.candidate.candidateDigest,
    revisionDigest: activation.revisionDigest,
    snapshotId: activation.snapshotId,
    ...(input.previousRelease !== undefined
      && { previousReleaseId: input.previousRelease.id }),
    rollback: EvolutionRollbackMetadata.make({
      previousTargetDigest: input.run.target.baselineDigest,
      previousRevisionDigest: activation.previousRevisionDigest,
      previousSnapshotId: activation.previousSnapshotId,
      candidateRevisionDigest: activation.revisionDigest,
      candidateSnapshotId: activation.snapshotId,
    }),
    promotedBy: input.promoterId,
    promotedAt: input.now,
    status,
  });

const failedRelease = (canary: EvolutionRelease): EvolutionRelease =>
  EvolutionRelease.make({
    ...canary,
    id: EvolutionReleaseIdSchema.make(`evl_${crypto.randomUUID()}`),
    canaryReleaseId: canary.id,
    status: "failed",
  });

const activatedRelease = (
  canary: EvolutionRelease,
  activation: EvolutionPromotionActivation,
): EvolutionRelease =>
  EvolutionRelease.make({
    ...canary,
    id: EvolutionReleaseIdSchema.make(`evl_${crypto.randomUUID()}`),
    revisionDigest: activation.revisionDigest,
    snapshotId: activation.snapshotId,
    canaryReleaseId: canary.id,
    auditCrossLinkDigest: activation.auditCrossLinkDigest,
    rollback: EvolutionRollbackMetadata.make({
      previousTargetDigest: canary.rollback.previousTargetDigest,
      previousRevisionDigest: activation.previousRevisionDigest,
      previousSnapshotId: activation.previousSnapshotId,
      candidateRevisionDigest: activation.revisionDigest,
      candidateSnapshotId: activation.snapshotId,
    }),
    status: "active",
  });

export const promoteEvolutionRelease = Effect.fn("promoteEvolutionProposal")(
  function*(
    input: EvolutionPromotionInput,
    hooks: EvolutionReleaseHooks,
    stores: EvolutionReleaseStores,
  ) {
    yield* assertPromotionEligible(input);
    yield* hooks.recordPromotionIntent(input);
    const prepared = yield* hooks.prepareCandidate(input);
    const canaryRelease = releaseFromActivation(input, prepared, "canary");
    yield* stores.releases.save(canaryRelease);
    yield* saveCanaryRun(input, stores, canaryRelease);
    yield* hooks.recordCanaryIntent(canaryRelease);
    if (!(yield* hooks.runCanary(canaryRelease))) {
      yield* recordEvolutionCanaryMetric(
        input.run.target.targetClass,
        "failed",
      );
      yield* hooks.recordCanaryFailed(canaryRelease);
      yield* stores.releases.save(failedRelease(canaryRelease));
      yield* saveFailedCanaryRun(
        input,
        stores,
        yield* stores.runs.get(input.run.id),
      );
      return yield* EvolutionPromotionError.make({
        proposalId: input.proposal.id,
        stage: "canary",
        reason: "canary failed before candidate activation",
      });
    }
    yield* recordEvolutionCanaryMetric(
      input.run.target.targetClass,
      "passed",
    );
    const activation = yield* hooks.activateCandidate(input, prepared);
    const release = activatedRelease(canaryRelease, activation);
    yield* stores.releases.save(release);
    yield* hooks.recordPromoted(release);
    yield* savePromotedRun(input, stores, release);
    return release;
  },
);
