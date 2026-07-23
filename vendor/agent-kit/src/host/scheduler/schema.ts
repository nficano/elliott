import * as Schema from "effect/Schema";

export const AdvisoryLockRowsSchema = Schema.Array(
  Schema.Struct({ locked: Schema.Boolean }),
);
