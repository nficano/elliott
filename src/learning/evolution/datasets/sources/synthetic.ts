import * as Effect from "effect/Effect";
import {
  EvolutionDatasetSource,
  type EvolutionTarget,
} from "../../model/index";
import type {
  EvolutionDatasetSourceResult,
  EvolutionSyntheticCaseGenerator,
} from "./types";

export const generateSyntheticDatasetSource = Effect.fn(
  "generateSyntheticEvolutionDatasetSource",
)(function*(
  target: EvolutionTarget,
  count: number,
  generator: EvolutionSyntheticCaseGenerator,
) {
  const cases = yield* generator.generate(target, count);
  return {
    source: EvolutionDatasetSource.make({
      kind: "synthetic",
      reference: target.componentRef,
      digest: `sha256:synthetic:${target.baselineDigest}:${count}`,
      classification: "internal",
      consentOrLicense: "generated-for-evaluation",
    }),
    cases,
  } satisfies EvolutionDatasetSourceResult;
});
