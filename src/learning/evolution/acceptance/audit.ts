import * as Effect from "effect/Effect";
import type { EvolutionProductionAcceptanceManifest } from "../model/index";
import { EvolutionProductionAcceptanceReport } from "../model/index";
import {
  auditAcceptanceCodeCampaigns,
  auditAcceptanceCompanions,
  auditAcceptanceExecutors,
  auditAcceptanceGlobalEvidence,
} from "./deployment-checks";
import { auditAcceptanceLineages } from "./lineage";
import { auditAcceptanceReleases } from "./release-checks";
import type { EvolutionAcceptanceArtifactReader } from "./types";

export const auditEvolutionProductionAcceptance = Effect.fn(
  "auditEvolutionProductionAcceptance",
)(function*(
  manifest: EvolutionProductionAcceptanceManifest,
  reader: EvolutionAcceptanceArtifactReader,
) {
  const lineageFindings = yield* auditAcceptanceLineages(manifest, reader);
  const findings = [
    ...auditAcceptanceCompanions(manifest),
    ...auditAcceptanceExecutors(manifest),
    ...auditAcceptanceGlobalEvidence(manifest),
    ...auditAcceptanceCodeCampaigns(manifest),
    ...auditAcceptanceReleases(manifest),
    ...lineageFindings,
  ];
  return yield* Effect.succeed(EvolutionProductionAcceptanceReport.make({
    manifestId: manifest.id,
    environment: manifest.environment,
    observedAt: manifest.observedAt,
    passed: findings.length === 0,
    findings,
  }));
});
