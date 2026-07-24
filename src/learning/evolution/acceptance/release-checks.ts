import type {
  EvolutionProductionAcceptanceManifest,
  EvolutionProductionReleaseEvidence,
} from "../model/index";
import { acceptanceFinding } from "./finding";

const SKILL_MINIMUM_IMPROVEMENT = 0.1;
const TOOL_MINIMUM_IMPROVEMENT = 0.05;
const PROMPT_MINIMUM_IMPROVEMENT = 0.1;
const TEXT_BROAD_REGRESSION_LIMIT = 0.02;

const minimumImprovement = (
  evidence: EvolutionProductionReleaseEvidence,
): number => {
  if (evidence.targetClass === "skill") return SKILL_MINIMUM_IMPROVEMENT;
  if (evidence.targetClass === "tool-description") {
    return TOOL_MINIMUM_IMPROVEMENT;
  }
  return evidence.targetClass === "prompt-segment"
    ? PROMPT_MINIMUM_IMPROVEMENT
    : 0;
};

const broadRegressionLimit = (
  evidence: EvolutionProductionReleaseEvidence,
): number =>
  evidence.targetClass === "prompt-segment"
    ? 0
    : TEXT_BROAD_REGRESSION_LIMIT;

const auditReleaseGates = (
  evidence: EvolutionProductionReleaseEvidence,
) => {
  const requiredFlags = evidence.humanApproved
    && evidence.phaseGatePassed
    && evidence.fullChecksPassed
    && evidence.canaryPassed
    && evidence.protectedMetricsPassed
    && evidence.frozenSurfacesPassed
    && evidence.lineageRetained;
  return requiredFlags && evidence.reviewRecordDigests.length > 0
    ? []
    : [acceptanceFinding(
      `release.${evidence.targetClass}.gates`,
      "review, phase, checks, canary, frozen surfaces, and retention must pass",
    )];
};

const auditReleasePerformance = (
  evidence: EvolutionProductionReleaseEvidence,
) => {
  const findings = [];
  if (evidence.primaryImprovementRatio < minimumImprovement(evidence)) {
    findings.push(acceptanceFinding(
      `release.${evidence.targetClass}.improvement`,
      "the production release does not meet its phase improvement threshold",
    ));
  }
  if (evidence.broadRegressionRatio > broadRegressionLimit(evidence)) {
    findings.push(acceptanceFinding(
      `release.${evidence.targetClass}.broad-regression`,
      "the production release exceeds its broad benchmark regression limit",
    ));
  }
  return findings;
};

const auditTargetSpecificRelease = (
  evidence: EvolutionProductionReleaseEvidence,
) => {
  const findings = [];
  if (
    evidence.targetClass === "code" && !evidence.knownDefectHoldoutPassed
  ) {
    findings.push(acceptanceFinding(
      "release.code.known-defect",
      "the code release lacks a passing known-defect holdout",
    ));
  }
  if (
    evidence.targetClass === "prompt-segment"
    && !evidence.independentStyleIdentityPassed
  ) {
    findings.push(acceptanceFinding(
      "release.prompt-segment.independent-judge",
      "the prompt release lacks independent style and identity evidence",
    ));
  }
  return findings;
};

const auditRelease = (
  evidence: EvolutionProductionReleaseEvidence,
) => [
  ...auditReleaseGates(evidence),
  ...auditReleasePerformance(evidence),
  ...auditTargetSpecificRelease(evidence),
];

export const auditAcceptanceReleases = (
  manifest: EvolutionProductionAcceptanceManifest,
) => {
  const findings = manifest.releases.flatMap((evidence) =>
    auditRelease(evidence)
  );
  for (
    const targetClass of [
      "skill",
      "tool-description",
      "prompt-segment",
      "code",
    ] as const
  ) {
    const count = manifest.releases.filter((item) =>
      item.targetClass === targetClass
    ).length;
    if (count !== 1) {
      findings.push(acceptanceFinding(
        `release.${targetClass}.count`,
        `exactly one production ${targetClass} release must be attested`,
      ));
    }
  }
  return findings;
};
