import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import path from "node:path";
import { EvolutionNotFoundError } from "../errors";
import { EvolutionRelease } from "../model/index";
import { EvolutionReleaseStore } from "../services";
import type { EvolutionReleaseStoreShape } from "../types";
import { decodeJson, encodeJson } from "./codec";
import {
  containedPath,
  fileExists,
  listFiles,
  readText,
  writeTextImmutable,
} from "./files";

const releaseFile = (root: string, id: string) =>
  containedPath(root, "releases", `${id}.json`);

const readRelease = (filePath: string) =>
  readText(filePath).pipe(
    Effect.flatMap((source) => decodeJson(EvolutionRelease, filePath, source)),
  );

const listReleases = Effect.fn("EvolutionReleaseStore.list")(function*(
  root: string,
) {
  const directory = yield* containedPath(root, "releases");
  if (!(yield* fileExists(directory))) return [];
  const names = yield* listFiles(directory);
  return yield* Effect.forEach(
    names
      .filter((name) => path.extname(name) === ".json")
      .toSorted((left, right) => left.localeCompare(right)),
    (name) =>
      containedPath(directory, name).pipe(
        Effect.flatMap(readRelease),
      ),
    { concurrency: 1 },
  );
});

const activeRelease = Effect.fn("EvolutionReleaseStore.activeForTarget")(
  function*(root: string, targetRef: string) {
    const releases = yield* listReleases(root);
    const active = releases
      .filter((release) =>
        release.targetRef === targetRef && release.status === "active"
      )
      .toSorted((left, right) =>
        right.promotedAt.localeCompare(left.promotedAt)
      )[0];
    if (active !== undefined) return active;
    return yield* EvolutionNotFoundError.make({
      artifact: "active-evolution-release",
      id: targetRef,
    });
  },
);

export const makeEvolutionReleaseStore = (
  root: string,
): EvolutionReleaseStoreShape => {
  const list = () => listReleases(root);

  return {
    save: Effect.fn("EvolutionReleaseStore.save")(function*(
      release: EvolutionRelease,
    ) {
      const filePath = yield* releaseFile(root, release.id);
      const source = yield* encodeJson(EvolutionRelease, filePath, release);
      yield* writeTextImmutable(filePath, source);
      return release;
    }),
    get: Effect.fn("EvolutionReleaseStore.get")(function*(
      id: Parameters<EvolutionReleaseStoreShape["get"]>[0],
    ) {
      const filePath = yield* releaseFile(root, id);
      if (!(yield* fileExists(filePath))) {
        return yield* EvolutionNotFoundError.make({
          artifact: "evolution-release",
          id,
        });
      }
      return yield* readRelease(filePath);
    }),
    activeForTarget: (targetRef) => activeRelease(root, targetRef),
    list,
  };
};

export const EvolutionReleaseStoreLive = (root: string) =>
  Layer.succeed(EvolutionReleaseStore, makeEvolutionReleaseStore(root));
