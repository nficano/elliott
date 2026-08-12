import type {
  EvolutionCompanionDeploymentEvidence,
  EvolutionExecutorDeploymentEvidence,
  EvolutionProductionAcceptanceManifest,
} from "../model/index";
import { acceptanceFinding } from "./finding";

// The `companion.*` requirement-ID strings emitted here (and the auditCompanion
// /auditAcceptanceCompanions names) are legacy wire identifiers kept for
// stored-evidence and report compatibility after the companions -> darwin
// rename. Acceptance reports and their tests assert these literals, so they must
// not change to "darwin.*".
const auditCompanion = (
  evidence: EvolutionCompanionDeploymentEvidence,
) => {
  const findings = [];
  if (!evidence.imageRef.endsWith(`@${evidence.imageDigest}`)) {
    findings.push(acceptanceFinding(
      `companion.${evidence.engineKind}.digest`,
      "registry image reference does not bind the declared image digest",
    ));
  }
  if (evidence.platforms.length === 0) {
    findings.push(acceptanceFinding(
      `companion.${evidence.engineKind}.platform`,
      "no production image platform is attested",
    ));
  }
  if (
    !evidence.registryPublished
    || !evidence.vulnerabilityScanPassed
    || !evidence.deploymentVerified
  ) {
    findings.push(acceptanceFinding(
      `companion.${evidence.engineKind}.deployment`,
      "registry publication, vulnerability scan, and deployment must pass",
    ));
  }
  return findings;
};

export const auditAcceptanceCompanions = (
  manifest: EvolutionProductionAcceptanceManifest,
) => {
  const required = ["gepa", "miprov2", "darwinian"] as const;
  const findings = manifest.companions.flatMap(auditCompanion);
  for (const engineKind of required) {
    if (manifest.companions.every((item) => item.engineKind !== engineKind)) {
      findings.push(acceptanceFinding(
        `companion.${engineKind}.present`,
        `no ${engineKind} production deployment evidence is present`,
      ));
    }
  }
  return findings;
};

const auditExecutor = (
  evidence: EvolutionExecutorDeploymentEvidence,
) =>
  evidence.deployed && evidence.loopbackOnly
    ? []
    : [acceptanceFinding(
      `executor.${evidence.executorKind}.deployment`,
      "executor must be deployed behind the protected loopback boundary",
    )];

export const auditAcceptanceExecutors = (
  manifest: EvolutionProductionAcceptanceManifest,
) => {
  const required = [
    "candidate-check",
    "evaluation-case",
    "broad-benchmark",
    "canary",
  ] as const;
  const findings = manifest.executors.flatMap(auditExecutor);
  for (const executorKind of required) {
    if (
      manifest.executors.every((item) => item.executorKind !== executorKind)
    ) {
      findings.push(acceptanceFinding(
        `executor.${executorKind}.present`,
        `no ${executorKind} production executor evidence is present`,
      ));
    }
  }
  return findings;
};

const auditLegal = (
  manifest: EvolutionProductionAcceptanceManifest,
) => {
  return manifest.darwinianLegal.distributionApproved
    ? []
    : [acceptanceFinding(
      "darwinian.legal",
      "Darwinian production distribution is not organizationally approved",
    )];
};

const auditRoutes = (
  manifest: EvolutionProductionAcceptanceManifest,
) =>
  manifest.routes.authoringRouteDigest
      !== manifest.routes.evaluationRouteDigest
    && manifest.routes.authoringRouteAuthorized
    && manifest.routes.evaluationRouteAuthorized
    ? []
    : [acceptanceFinding(
      "routes.separation",
      "author and judge routes must be distinct and authorized",
    )];

const auditCi = (
  manifest: EvolutionProductionAcceptanceManifest,
) =>
  manifest.ci.repositoryGatePassed
    && manifest.ci.g01ThroughG25Passed
    && manifest.ci.se01ThroughSe15Passed
    ? []
    : [acceptanceFinding(
      "ci.gates",
      "repository, G1-G25, and SE1-SE15 gates must pass in CI",
    )];

const auditScheduler = (
  manifest: EvolutionProductionAcceptanceManifest,
) =>
  manifest.scheduler.unattended
    && !manifest.scheduler.canApprove
    && !manifest.scheduler.canPromote
    ? []
    : [acceptanceFinding(
      "scheduler.authority",
      "scheduler must produce a Proposal unattended without approval authority",
    )];

export const auditAcceptanceGlobalEvidence = (
  manifest: EvolutionProductionAcceptanceManifest,
) => [
  ...auditLegal(manifest),
  ...auditRoutes(manifest),
  ...auditCi(manifest),
  ...auditScheduler(manifest),
];

export const auditAcceptanceCodeCampaigns = (
  manifest: EvolutionProductionAcceptanceManifest,
) => {
  const findings = [];
  for (const riskClass of ["C1", "C2"] as const) {
    const campaign = manifest.codeCampaigns.find((item) =>
      item.riskClass === riskClass
    );
    if (
      campaign === undefined
      || !campaign.campaignPassed
      || !campaign.knownDefectHoldoutPassed
    ) {
      findings.push(acceptanceFinding(
        `code-campaign.${riskClass}`,
        `${riskClass} campaign and known-defect holdout must pass`,
      ));
    }
  }
  return findings;
};
