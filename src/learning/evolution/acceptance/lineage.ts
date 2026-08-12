import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  EvolutionProductionAcceptanceManifest,
  EvolutionProductionReleaseEvidence,
} from "../model/index";
import { acceptanceFinding } from "./finding";
import { auditAcceptanceLineageArtifacts } from "./lineage-checks";
import type {
  EvolutionAcceptanceArtifactReader,
  EvolutionAcceptanceLineageArtifacts,
} from "./types";

const missingArtifactFindings = (
  evidence: EvolutionProductionReleaseEvidence,
  presence: Readonly<Record<string, boolean>>,
) =>
  Object.entries(presence)
    .filter(([, present]) => !present)
    .map(([artifact]) =>
      acceptanceFinding(
        `release.${evidence.targetClass}.${artifact}`,
        `durable ${artifact} artifact is missing or invalid`,
      )
    );

const loadLineageOptions = Effect.fn("loadEvolutionProductionLineage")(
  function*(
    evidence: EvolutionProductionReleaseEvidence,
    reader: EvolutionAcceptanceArtifactReader,
  ) {
    const options = yield* Effect.all({
      release: reader.release(evidence.releaseId).pipe(Effect.option),
      canaryRelease: reader.release(evidence.canaryReleaseId).pipe(
        Effect.option,
      ),
      rollbackRelease: reader.release(evidence.rollbackReleaseId).pipe(
        Effect.option,
      ),
      run: reader.run(evidence.runId).pipe(Effect.option),
      candidate: reader.candidate(evidence.candidateId).pipe(Effect.option),
      dataset: reader.dataset(evidence.datasetId).pipe(Effect.option),
      report: reader.report(evidence.evaluationReportId).pipe(Effect.option),
      proposal: reader.proposal(evidence.proposalId).pipe(Effect.option),
      baselineSnapshot: reader.snapshot(evidence.baselineSnapshotId).pipe(
        Effect.option,
      ),
      evaluationSnapshot: reader.snapshot(evidence.evaluationSnapshotId).pipe(
        Effect.option,
      ),
      releaseSnapshot: reader.snapshot(evidence.snapshotId).pipe(Effect.option),
    });
    const rollbackSnapshot = Option.isSome(options.rollbackRelease)
      ? yield* reader.snapshot(options.rollbackRelease.value.snapshotId).pipe(
        Effect.option,
      )
      : Option.none();
    return { options, rollbackSnapshot };
  },
);

const auditLineage = Effect.fn("auditEvolutionProductionLineage")(function*(
  manifest: EvolutionProductionAcceptanceManifest,
  evidence: EvolutionProductionReleaseEvidence,
  reader: EvolutionAcceptanceArtifactReader,
) {
  const { options, rollbackSnapshot } = yield* loadLineageOptions(
    evidence,
    reader,
  );
  const complete = Option.all({ ...options, rollbackSnapshot });
  if (Option.isNone(complete)) {
    return missingArtifactFindings(evidence, {
      release: Option.isSome(options.release),
      "canary-release": Option.isSome(options.canaryRelease),
      "rollback-release": Option.isSome(options.rollbackRelease),
      run: Option.isSome(options.run),
      candidate: Option.isSome(options.candidate),
      dataset: Option.isSome(options.dataset),
      "evaluation-report": Option.isSome(options.report),
      proposal: Option.isSome(options.proposal),
      "baseline-snapshot": Option.isSome(options.baselineSnapshot),
      "evaluation-snapshot": Option.isSome(options.evaluationSnapshot),
      "release-snapshot": Option.isSome(options.releaseSnapshot),
      "rollback-snapshot": Option.isSome(rollbackSnapshot),
    });
  }
  return yield* auditAcceptanceLineageArtifacts({
    manifest,
    evidence,
    artifacts: complete.value satisfies EvolutionAcceptanceLineageArtifacts,
  });
});

export const auditAcceptanceLineages = Effect.fn(
  "auditEvolutionProductionLineages",
)(function*(
  manifest: EvolutionProductionAcceptanceManifest,
  reader: EvolutionAcceptanceArtifactReader,
) {
  const findings = yield* Effect.forEach(
    manifest.releases,
    (evidence) => auditLineage(manifest, evidence, reader),
    { concurrency: 1 },
  );
  return findings.flat();
});
