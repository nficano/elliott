import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { EvolutionPromotionError } from "../errors";
import type { EvolutionRelease } from "../model/index";
import type {
  EvolutionKernelReleaseConfig,
  EvolutionKernelReleaseRecordInput,
  EvolutionPreparedRelease,
  EvolutionPromotionActivation,
  EvolutionPromotionInput,
  EvolutionReleaseHooks,
} from "./types";

const promotionFailure = (
  proposalId: string,
  stage: string,
  cause: unknown,
): EvolutionPromotionError =>
  EvolutionPromotionError.make({
    proposalId,
    stage,
    reason: `kernel release transaction failed during ${stage}`,
    cause,
  });

const record = (
  config: EvolutionKernelReleaseConfig,
  input: EvolutionKernelReleaseRecordInput,
) =>
  Effect.tryPromise({
    try: () =>
      config.records.append({
        type: input.type,
        scope: { level: "workspace", id: scopeId(config.workspaceId) },
        durability: "effect-gating",
        classification: "internal",
        payload: { proposalId: input.proposalId, ...input.payload },
      }),
    catch: (cause) => promotionFailure(input.proposalId, input.type, cause),
  }).pipe(Effect.asVoid);

const bumpAndCrossLink = Effect.fn("finalizeEvolutionActivation")(function*(
  config: EvolutionKernelReleaseConfig,
  proposalId: string,
) {
  yield* Effect.tryPromise({
    try: () =>
      config.epochs.bump(
        "workspace",
        config.workspaceId,
        "proposal-deployment",
      ),
    catch: (cause) => promotionFailure(proposalId, "epoch-bump", cause),
  });
  return yield* Effect.tryPromise({
    try: () => config.records.crossLink(),
    catch: (cause) => promotionFailure(proposalId, "cross-link", cause),
  });
});

const prepareCandidate = Effect.fn("prepareEvolutionRevision")(function*(
  config: EvolutionKernelReleaseConfig,
  input: EvolutionPromotionInput,
) {
  const revision = config.candidateRevision(input);
  if (
    revision.parentDigest === undefined
    || revision.parentDigest !== config.activation.active.digest
  ) {
    return yield* promotionFailure(
      input.proposal.id,
      "prepare-candidate",
      "candidate parent does not match the active immutable revision",
    );
  }
  const snapshot = config.snapshots.create(
    config.candidateSnapshot(input, revision),
  );
  return {
    revisionDigest: revision.digest,
    snapshotId: snapshot.id,
    previousRevisionDigest: revision.parentDigest,
    previousSnapshotId: input.run.baselineSnapshotId,
    touchedEpochs: revision.touchedEpochs,
  } satisfies EvolutionPreparedRelease;
});

const activateCandidate = Effect.fn("activateEvolutionRevision")(function*(
  config: EvolutionKernelReleaseConfig,
  input: EvolutionPromotionInput,
  prepared: EvolutionPreparedRelease,
) {
  const revision = config.candidateRevision(input);
  if (revision.digest !== prepared.revisionDigest) {
    return yield* promotionFailure(
      input.proposal.id,
      "activation",
      "prepared candidate revision changed before activation",
    );
  }
  const result = yield* Effect.tryPromise({
    try: () => config.activation.activate(revision),
    catch: (cause) => promotionFailure(input.proposal.id, "activation", cause),
  });
  if (result.type !== "activated") {
    return yield* promotionFailure(
      input.proposal.id,
      "activation",
      result.type,
    );
  }
  const crossLink = yield* bumpAndCrossLink(config, input.proposal.id);
  return {
    ...prepared,
    auditCrossLinkDigest: crossLink.digest,
  } satisfies EvolutionPromotionActivation;
});

const rollbackRevision = Effect.fn("activatePriorEvolutionRevision")(function*(
  config: EvolutionKernelReleaseConfig,
  release: EvolutionRelease,
) {
  const revision = config.revisionByDigest(
    release.rollback.previousRevisionDigest,
  );
  if (revision === undefined) {
    return yield* promotionFailure(
      release.proposalId,
      "rollback-revision",
      "immutable prior revision is unavailable",
    );
  }
  const result = yield* Effect.tryPromise({
    try: () => config.activation.rollback(revision),
    catch: (cause) =>
      promotionFailure(release.proposalId, "rollback-activation", cause),
  });
  if (result.type !== "activated") {
    return yield* promotionFailure(
      release.proposalId,
      "rollback-activation",
      result.type,
    );
  }
  const snapshot = config.snapshots.create(
    config.rollbackSnapshot(release, revision),
  );
  const link = yield* bumpAndCrossLink(config, release.proposalId);
  return {
    revisionDigest: revision.digest,
    snapshotId: snapshot.id,
    previousRevisionDigest: release.revisionDigest,
    previousSnapshotId: release.snapshotId,
    touchedEpochs: revision.touchedEpochs,
    auditCrossLinkDigest: link.digest,
  } satisfies EvolutionPromotionActivation;
});

const releaseRecord = (
  config: EvolutionKernelReleaseConfig,
  type: string,
  release: EvolutionRelease,
) =>
  record(config, {
    type,
    proposalId: release.proposalId,
    payload: {
      releaseId: release.id,
      revisionDigest: release.revisionDigest,
      snapshotId: release.snapshotId,
    },
  });

export const makeKernelReleaseHooks = (
  config: EvolutionKernelReleaseConfig,
): EvolutionReleaseHooks => ({
  recordPromotionIntent: (input) =>
    record(config, {
      type: "evolution.release.promotion-intent",
      proposalId: input.proposal.id,
      payload: {
        runId: input.run.id,
        candidateId: input.candidate.id,
        targetDigest: input.activeTargetDigest,
      },
    }),
  prepareCandidate: (input) => prepareCandidate(config, input),
  recordCanaryIntent: (release) =>
    releaseRecord(config, "evolution.canary.started", release),
  runCanary: (release) =>
    Effect.tryPromise({
      try: () => config.canary(release),
      catch: (cause) => promotionFailure(release.proposalId, "canary", cause),
    }),
  recordCanaryFailed: (release) =>
    releaseRecord(config, "evolution.canary.failed", release),
  activateCandidate: (input, prepared) =>
    activateCandidate(config, input, prepared),
  recordPromoted: (release) =>
    releaseRecord(config, "evolution.release.promoted", release),
  recordRollbackIntent: (release, principalId) =>
    record(config, {
      type: "evolution.release.rollback-intent",
      proposalId: release.proposalId,
      payload: { releaseId: release.id, principalId },
    }),
  activatePriorRevision: (release) => rollbackRevision(config, release),
  recordRolledBack: (release) =>
    releaseRecord(config, "evolution.release.rolled-back", release),
});
