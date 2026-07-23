import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const ReminderConfig = Schema.StructWithRest(
  Schema.Struct({
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
    ),
    /** How the owner is named in the tools' prose (e.g. "Nick"). */
    owner: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("the owner")),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type { Cfg } from "./types.js";
