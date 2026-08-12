import * as Effect from "effect/Effect";
import path from "node:path";
import { AuditLog, MemoryCommitAdapter } from "../../../audit/index";
import { snapshotId } from "../../../core/brands";
import { FileSnapshotStore } from "../../../core/snapshot/snapshot";
import type { SnapshotStore } from "../../../core/snapshot/snapshot";
import { FileProposalStore } from "../../proposals/index";
import { EvolutionAcceptanceArtifactError } from "../errors";
import {
  makeEvolutionCandidateStore,
  makeEvolutionDatasetStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "../store/index";
import type { EvolutionAcceptanceArtifactReader } from "./types";

const artifactError = (
  artifact: string,
  id: string,
  cause?: unknown,
): EvolutionAcceptanceArtifactError =>
  EvolutionAcceptanceArtifactError.make({
    artifact,
    id,
    ...(cause !== undefined && { cause }),
  });

const requireArtifact = <A>(
  artifact: string,
  id: string,
  value: A | undefined,
): Effect.Effect<A, EvolutionAcceptanceArtifactError> =>
  value === undefined
    ? artifactError(artifact, id)
    : Effect.succeed(value);

const acceptanceReader = (
  root: string,
  proposals: FileProposalStore,
  snapshots: SnapshotStore,
): EvolutionAcceptanceArtifactReader => {
  const evolutionRoot = path.join(root, "evolution");
  const releases = makeEvolutionReleaseStore(evolutionRoot);
  const runs = makeEvolutionRunStore(evolutionRoot);
  const candidates = makeEvolutionCandidateStore(evolutionRoot);
  const datasets = makeEvolutionDatasetStore(evolutionRoot);
  const reports = makeEvolutionEvaluationReportStore(evolutionRoot);
  return {
    release: (id) =>
      releases.get(id).pipe(
        Effect.mapError((cause) =>
          artifactError("evolution-release", id, cause)
        ),
      ),
    run: (id) =>
      runs.get(id).pipe(
        Effect.mapError((cause) => artifactError("evolution-run", id, cause)),
      ),
    candidate: (id) =>
      candidates.get(id).pipe(
        Effect.mapError((cause) =>
          artifactError("evolution-candidate", id, cause)
        ),
      ),
    dataset: (id) =>
      datasets.get(id).pipe(
        Effect.mapError((cause) =>
          artifactError("evolution-dataset", id, cause)
        ),
      ),
    report: (id) =>
      reports.get(id).pipe(
        Effect.mapError((cause) =>
          artifactError("evolution-evaluation-report", id, cause)
        ),
      ),
    proposal: (id) =>
      requireArtifact("evolution-proposal", id, proposals.get(id)),
    snapshot: (id) =>
      requireArtifact(
        "evolution-snapshot",
        id,
        snapshots.get(snapshotId(id)),
      ),
  };
};

export const makeFileEvolutionAcceptanceReader = Effect.fn(
  "makeFileEvolutionAcceptanceReader",
)(function*(runtimeStateRoot: string) {
  const root = path.resolve(runtimeStateRoot);
  const records = new AuditLog(new MemoryCommitAdapter());
  const proposals = yield* Effect.tryPromise({
    try: () =>
      FileProposalStore.open({
        root: path.join(root, "proposals"),
        records,
      }),
    catch: (cause) =>
      artifactError("evolution-proposal-store", runtimeStateRoot, cause),
  });
  const snapshots = yield* Effect.try({
    try: () => new FileSnapshotStore(path.join(root, "snapshots")),
    catch: (cause) =>
      artifactError("evolution-snapshot-store", runtimeStateRoot, cause),
  });
  return acceptanceReader(root, proposals, snapshots);
});
