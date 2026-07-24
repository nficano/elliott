import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionDatasetManifest } from "../model/index";
import { EvolutionDatasetStore } from "../services";
import type { EvolutionDatasetStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  readText,
  writeTextImmutable,
} from "./files";

const datasetFile = (root: string, id: string) =>
  containedPath(root, "datasets", `${id}.json`);

export const makeEvolutionDatasetStore = (
  root: string,
): EvolutionDatasetStoreShape => ({
  save: Effect.fn("EvolutionDatasetStore.save")(function*(
    dataset: EvolutionDatasetManifest,
  ) {
    const filePath = yield* datasetFile(root, dataset.id);
    const source = yield* encodeJson(
      EvolutionDatasetManifest,
      filePath,
      dataset,
    );
    yield* writeTextImmutable(filePath, source);
    return dataset;
  }),
  get: Effect.fn("EvolutionDatasetStore.get")(function*(
    id: Parameters<EvolutionDatasetStoreShape["get"]>[0],
  ) {
    const filePath = yield* datasetFile(root, id);
    if (!(yield* fileExists(filePath))) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-dataset",
        id,
      });
    }
    const source = yield* readText(filePath);
    return yield* decodeJson(EvolutionDatasetManifest, filePath, source);
  }),
});

export const EvolutionDatasetStoreLive = (root: string) =>
  Layer.succeed(EvolutionDatasetStore, makeEvolutionDatasetStore(root));
