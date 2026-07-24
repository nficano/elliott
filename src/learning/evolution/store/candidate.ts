import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import path from "node:path";
import { hashBytes } from "../../../core/digest";
import { EvolutionDecodeError, EvolutionNotFoundError } from "../errors";
import { EvolutionCandidate } from "../model/index";
import { EvolutionCandidateStore } from "../services";
import type { EvolutionCandidateStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  listFiles,
  readText,
  writeTextImmutable,
} from "./files";

const candidateFile = (root: string, runId: string, candidateId: string) =>
  containedPath(root, "candidates", runId, `${candidateId}.json`);

const readCandidate = (filePath: string) =>
  readText(filePath).pipe(
    Effect.flatMap((source) =>
      decodeJson(EvolutionCandidate, filePath, source)
    ),
  );

const findCandidate = Effect.fn("EvolutionCandidateStore.get")(function*(
  root: string,
  id: Parameters<EvolutionCandidateStoreShape["get"]>[0],
) {
  const directory = yield* containedPath(root, "candidates");
  if (yield* fileExists(directory)) {
    const runDirectories = yield* listFiles(directory);
    for (
      const runDirectory of runDirectories.toSorted((left, right) =>
        left.localeCompare(right)
      )
    ) {
      const filePath = yield* containedPath(
        directory,
        runDirectory,
        `${id}.json`,
      );
      if (yield* fileExists(filePath)) return yield* readCandidate(filePath);
    }
  }
  return yield* EvolutionNotFoundError.make({
    artifact: "evolution-candidate",
    id,
  });
});

const listCandidatesForRun = Effect.fn(
  "EvolutionCandidateStore.listForRun",
)(function*(
  root: string,
  runId: Parameters<EvolutionCandidateStoreShape["listForRun"]>[0],
) {
  const directory = yield* containedPath(root, "candidates", runId);
  if (!(yield* fileExists(directory))) return [];
  const names = yield* listFiles(directory);
  return yield* Effect.forEach(
    names
      .filter((name) => path.extname(name) === ".json")
      .toSorted((left, right) => left.localeCompare(right)),
    (name) =>
      containedPath(directory, name).pipe(
        Effect.flatMap(readCandidate),
      ),
    { concurrency: 1 },
  );
});

const assertCandidateDigest = (
  candidate: EvolutionCandidate,
): Effect.Effect<void, EvolutionDecodeError> => {
  const materialized = candidate.materializedContent ?? candidate.patch;
  const actual = hashBytes(materialized);
  return actual === candidate.candidateDigest
    ? Effect.void
    : EvolutionDecodeError.make({
      artifact: `evolution-candidate-digest:${candidate.id}`,
      cause: `expected ${candidate.candidateDigest}, computed ${actual}`,
    });
};

export const makeEvolutionCandidateStore = (
  root: string,
): EvolutionCandidateStoreShape => ({
  save: Effect.fn("EvolutionCandidateStore.save")(function*(
    candidate: EvolutionCandidate,
  ) {
    yield* assertCandidateDigest(candidate);
    const filePath = yield* candidateFile(
      root,
      candidate.runId,
      candidate.id,
    );
    const source = yield* encodeJson(EvolutionCandidate, filePath, candidate);
    yield* writeTextImmutable(filePath, source);
    return candidate;
  }),
  get: (id) => findCandidate(root, id),
  listForRun: (runId) => listCandidatesForRun(root, runId),
});

export const EvolutionCandidateStoreLive = (root: string) =>
  Layer.succeed(EvolutionCandidateStore, makeEvolutionCandidateStore(root));
