import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionDecodeError } from "../errors";

export const decodeJson = <A, I, R>(
  schema: Schema.Codec<A, I, R>,
  artifact: string,
  source: string,
): Effect.Effect<A, EvolutionDecodeError, R> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(source).pipe(
    Effect.mapError((cause) => EvolutionDecodeError.make({ artifact, cause })),
  );

export const encodeJson = <A, I, R>(
  schema: Schema.Codec<A, I, R>,
  artifact: string,
  value: A,
): Effect.Effect<string, EvolutionDecodeError, R> =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.map((encoded) => `${JSON.stringify(encoded, undefined, 2)}\n`),
    Effect.mapError((cause) => EvolutionDecodeError.make({ artifact, cause })),
  );
