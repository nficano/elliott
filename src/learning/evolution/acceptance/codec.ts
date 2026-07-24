import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionDecodeError } from "../errors";
import { EvolutionProductionAcceptanceManifest } from "../model/index";

export const decodeEvolutionProductionAcceptanceManifest = Effect.fn(
  "decodeEvolutionProductionAcceptanceManifest",
)(function*(artifact: string, input: unknown) {
  return yield* Schema.decodeUnknownEffect(
    EvolutionProductionAcceptanceManifest,
  )(input).pipe(
    Effect.mapError((cause) => EvolutionDecodeError.make({ artifact, cause })),
  );
});
