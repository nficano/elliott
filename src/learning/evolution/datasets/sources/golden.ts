import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EvolutionDatasetError } from "../../errors";
import {
  EvolutionDatasetSource,
  EvolutionUnsplitDatasetCase,
} from "../../model/index";
import type {
  EvolutionDatasetSourceResult,
  EvolutionGoldenSourceInput,
} from "./types";

const parseJsonUnknown = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

const decodeCases = (
  input: EvolutionGoldenSourceInput,
  source: string,
): Effect.Effect<
  readonly EvolutionUnsplitDatasetCase[],
  EvolutionDatasetError
> => {
  const extension = path.extname(input.filePath).toLowerCase();
  return Effect.try({
    try: (): unknown =>
      extension === ".jsonl"
        ? source.split(/\r?\n/u).filter(Boolean).map((line) =>
          parseJsonUnknown(line)
        )
        : parse(source),
    catch: (cause) =>
      EvolutionDatasetError.make({
        operation: "decode-golden-source",
        reason: String(cause),
        caseIds: [],
      }),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(EvolutionUnsplitDatasetCase)),
    ),
    Effect.mapError((cause) =>
      cause instanceof EvolutionDatasetError
        ? cause
        : EvolutionDatasetError.make({
          operation: "decode-golden-source",
          reason: String(cause),
          caseIds: [],
        })
    ),
  );
};

export const loadGoldenDatasetSource = Effect.fn(
  "loadGoldenEvolutionDatasetSource",
)(function*(input: EvolutionGoldenSourceInput) {
  const source = yield* Effect.tryPromise({
    try: () => readFile(input.filePath, "utf8"),
    catch: (cause) =>
      EvolutionDatasetError.make({
        operation: "read-golden-source",
        reason: String(cause),
        caseIds: [],
      }),
  });
  const cases = yield* decodeCases(input, source);
  return {
    source: EvolutionDatasetSource.make({
      kind: "golden",
      reference: input.filePath,
      digest: input.sourceDigest,
      classification: input.classification,
    }),
    cases,
  } satisfies EvolutionDatasetSourceResult;
});
