import * as Schema from "effect/Schema";
import {
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionReleaseIdSchema,
  EvolutionRunIdSchema,
} from "./identifiers";
import { NonNegativeFiniteSchema } from "./numeric";

export const EvolutionAcceptanceDigestSchema = Schema.String.check(
  Schema.isPattern(/^sha256:[0-9a-f]{64}$/u),
);

export const EvolutionAcceptanceTargetClassSchema = Schema.Literals([
  "skill",
  "tool-description",
  "prompt-segment",
  "code",
]);

// Legacy wire name kept for stored-evidence compatibility. The evolution layer
// directory was renamed companions -> darwin, but this Effect schema class tag
// (and its string tag below) are persisted in serialized acceptance manifests,
// so they must not change. Do not rename to "Darwin".
export class EvolutionCompanionDeploymentEvidence
  extends Schema.Class<EvolutionCompanionDeploymentEvidence>(
    "EvolutionCompanionDeploymentEvidence",
  )({
    engineKind: Schema.Literals(["gepa", "miprov2", "darwinian"]),
    componentRef: Schema.String,
    imageRef: Schema.String,
    imageDigest: EvolutionAcceptanceDigestSchema,
    registryPublicationDigest: EvolutionAcceptanceDigestSchema,
    vulnerabilityScanDigest: EvolutionAcceptanceDigestSchema,
    deploymentVerificationDigest: EvolutionAcceptanceDigestSchema,
    platforms: Schema.Array(Schema.String),
    isolation: Schema.Literals(["container", "remote"]),
    registryPublished: Schema.Boolean,
    vulnerabilityScanPassed: Schema.Boolean,
    deploymentVerified: Schema.Boolean,
  })
{}

export class EvolutionExecutorDeploymentEvidence
  extends Schema.Class<EvolutionExecutorDeploymentEvidence>(
    "EvolutionExecutorDeploymentEvidence",
  )({
    executorKind: Schema.Literals([
      "candidate-check",
      "evaluation-case",
      "broad-benchmark",
      "canary",
    ]),
    componentRef: Schema.String,
    endpointDigest: EvolutionAcceptanceDigestSchema,
    deploymentVerificationDigest: EvolutionAcceptanceDigestSchema,
    authentication: Schema.Literal("bearer"),
    snapshotResolution: Schema.Literal("immutable"),
    loopbackOnly: Schema.Boolean,
    deployed: Schema.Boolean,
  })
{}

export class EvolutionRouteSeparationEvidence
  extends Schema.Class<EvolutionRouteSeparationEvidence>(
    "EvolutionRouteSeparationEvidence",
  )({
    authoringRouteDigest: EvolutionAcceptanceDigestSchema,
    evaluationRouteDigest: EvolutionAcceptanceDigestSchema,
    authoringRouteAuthorized: Schema.Boolean,
    evaluationRouteAuthorized: Schema.Boolean,
  })
{}

export class EvolutionDarwinianLegalEvidence
  extends Schema.Class<EvolutionDarwinianLegalEvidence>(
    "EvolutionDarwinianLegalEvidence",
  )({
    license: Schema.Literal("AGPL-3.0"),
    approvalRecordDigest: EvolutionAcceptanceDigestSchema,
    correspondingSourceDigest: EvolutionAcceptanceDigestSchema,
    noticesDigest: EvolutionAcceptanceDigestSchema,
    distributionApproved: Schema.Boolean,
  })
{}

export class EvolutionCiAcceptanceEvidence
  extends Schema.Class<EvolutionCiAcceptanceEvidence>(
    "EvolutionCiAcceptanceEvidence",
  )({
    commitDigest: EvolutionAcceptanceDigestSchema,
    resultDigest: EvolutionAcceptanceDigestSchema,
    repositoryGatePassed: Schema.Boolean,
    g01ThroughG25Passed: Schema.Boolean,
    se01ThroughSe15Passed: Schema.Boolean,
  })
{}

export class EvolutionSchedulerAcceptanceEvidence
  extends Schema.Class<EvolutionSchedulerAcceptanceEvidence>(
    "EvolutionSchedulerAcceptanceEvidence",
  )({
    jobId: Schema.String,
    runId: EvolutionRunIdSchema,
    proposalId: Schema.String,
    completionRecordDigest: EvolutionAcceptanceDigestSchema,
    unattended: Schema.Boolean,
    canApprove: Schema.Boolean,
    canPromote: Schema.Boolean,
  })
{}

export class EvolutionCodeCampaignEvidence
  extends Schema.Class<EvolutionCodeCampaignEvidence>(
    "EvolutionCodeCampaignEvidence",
  )({
    riskClass: Schema.Literals(["C1", "C2"]),
    runId: EvolutionRunIdSchema,
    reportDigest: EvolutionAcceptanceDigestSchema,
    campaignPassed: Schema.Boolean,
    knownDefectHoldoutPassed: Schema.Boolean,
  })
{}

export class EvolutionProductionReleaseEvidence
  extends Schema.Class<EvolutionProductionReleaseEvidence>(
    "EvolutionProductionReleaseEvidence",
  )({
    targetClass: EvolutionAcceptanceTargetClassSchema,
    riskClass: Schema.Literals(["C1", "C2", "C3", "C4"]),
    releaseId: EvolutionReleaseIdSchema,
    canaryReleaseId: EvolutionReleaseIdSchema,
    rollbackReleaseId: EvolutionReleaseIdSchema,
    runId: EvolutionRunIdSchema,
    proposalId: Schema.String,
    candidateId: EvolutionCandidateIdSchema,
    datasetId: EvolutionDatasetIdSchema,
    evaluationReportId: EvolutionEvaluationReportIdSchema,
    targetRef: Schema.String,
    targetDigest: EvolutionAcceptanceDigestSchema,
    datasetDigest: EvolutionAcceptanceDigestSchema,
    revisionDigest: EvolutionAcceptanceDigestSchema,
    baselineSnapshotId: Schema.String,
    evaluationSnapshotId: Schema.String,
    snapshotId: Schema.String,
    auditCrossLinkDigest: EvolutionAcceptanceDigestSchema,
    rollbackAuditCrossLinkDigest: EvolutionAcceptanceDigestSchema,
    epochTransactionDigest: EvolutionAcceptanceDigestSchema,
    rollbackEpochTransactionDigest: EvolutionAcceptanceDigestSchema,
    lineageDigest: EvolutionAcceptanceDigestSchema,
    phaseGateReportDigest: EvolutionAcceptanceDigestSchema,
    productionDeploymentDigest: EvolutionAcceptanceDigestSchema,
    rollbackDrillDigest: EvolutionAcceptanceDigestSchema,
    reviewRecordDigests: Schema.Array(EvolutionAcceptanceDigestSchema),
    primaryImprovementRatio: NonNegativeFiniteSchema,
    broadRegressionRatio: NonNegativeFiniteSchema,
    humanApproved: Schema.Boolean,
    phaseGatePassed: Schema.Boolean,
    fullChecksPassed: Schema.Boolean,
    canaryPassed: Schema.Boolean,
    protectedMetricsPassed: Schema.Boolean,
    frozenSurfacesPassed: Schema.Boolean,
    knownDefectHoldoutPassed: Schema.Boolean,
    independentStyleIdentityPassed: Schema.Boolean,
    lineageRetained: Schema.Boolean,
  })
{}

export class EvolutionProductionAcceptanceManifest
  extends Schema.Class<EvolutionProductionAcceptanceManifest>(
    "EvolutionProductionAcceptanceManifest",
  )({
    id: Schema.String,
    schemaVersion: Schema.Literal(2),
    environment: Schema.String,
    observedAt: Schema.String,
    // Legacy wire field name kept for stored-evidence compatibility (see the
    // companions -> darwin rename); serialized manifests carry this key.
    companions: Schema.Array(EvolutionCompanionDeploymentEvidence),
    executors: Schema.Array(EvolutionExecutorDeploymentEvidence),
    routes: EvolutionRouteSeparationEvidence,
    darwinianLegal: EvolutionDarwinianLegalEvidence,
    ci: EvolutionCiAcceptanceEvidence,
    scheduler: EvolutionSchedulerAcceptanceEvidence,
    codeCampaigns: Schema.Array(EvolutionCodeCampaignEvidence),
    releases: Schema.Array(EvolutionProductionReleaseEvidence),
  })
{}

export class EvolutionAcceptanceFinding
  extends Schema.Class<EvolutionAcceptanceFinding>(
    "EvolutionAcceptanceFinding",
  )({
    requirement: Schema.String,
    message: Schema.String,
  })
{}

export class EvolutionProductionAcceptanceReport
  extends Schema.Class<EvolutionProductionAcceptanceReport>(
    "EvolutionProductionAcceptanceReport",
  )({
    manifestId: Schema.String,
    environment: Schema.String,
    observedAt: Schema.String,
    passed: Schema.Boolean,
    findings: Schema.Array(EvolutionAcceptanceFinding),
  })
{}
