import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import path from "node:path";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionRun } from "../model/index";
import { EvolutionRunStore } from "../services";
import type { EvolutionRunStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  listFiles,
  readText,
  writeTextAtomic,
} from "./files";

const runFile = (root: string, id: string) =>
  containedPath(root, "runs", `${id}.json`);

const readRun = (filePath: string) =>
  readText(filePath).pipe(
    Effect.flatMap((source) => decodeJson(EvolutionRun, filePath, source)),
  );

export const makeEvolutionRunStore = (
  root: string,
): EvolutionRunStoreShape => ({
  save: Effect.fn("EvolutionRunStore.save")(function*(run: EvolutionRun) {
    const filePath = yield* runFile(root, run.id);
    const source = yield* encodeJson(EvolutionRun, filePath, run);
    yield* writeTextAtomic(filePath, source);
    return run;
  }),
  get: Effect.fn("EvolutionRunStore.get")(function*(
    id: Parameters<EvolutionRunStoreShape["get"]>[0],
  ) {
    const filePath = yield* runFile(root, id);
    if (!(yield* fileExists(filePath))) {
      return yield* EvolutionNotFoundError.make({
        artifact: "evolution-run",
        id,
      });
    }
    return yield* readRun(filePath);
  }),
  list: Effect.fn("EvolutionRunStore.list")(function*() {
    const directory = yield* containedPath(root, "runs");
    if (!(yield* fileExists(directory))) return [];
    const names = yield* listFiles(directory);
    return yield* Effect.forEach(
      names
        .filter((name) => path.extname(name) === ".json")
        .toSorted((left, right) => left.localeCompare(right)),
      (name) =>
        containedPath(directory, name).pipe(
          Effect.flatMap(readRun),
        ),
      { concurrency: 1 },
    );
  }),
});

export const EvolutionRunStoreLive = (root: string) =>
  Layer.succeed(EvolutionRunStore, makeEvolutionRunStore(root));
