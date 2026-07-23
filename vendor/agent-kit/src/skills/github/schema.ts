import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const BRANCH_SUFFIX_PATTERN = /^(?!.*--)(?!-)[a-z0-9-]+(?<!-)$/;

function withDefault<S extends Schema.Top>(
  schema: S,
  value: () => S["Type"],
) {
  return schema.pipe(
    Schema.withDecodingDefaultType(Effect.sync(value)),
  );
}

/** Input for the `draft_pr` tool: anchored edits + new files on a stamped branch. */
export const DraftPrInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)),
  body: Schema.optional(Schema.String),
  branchSuffix: Schema.String.check(Schema.isPattern(BRANCH_SUFFIX_PATTERN)),
  edits: withDefault(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        find: Schema.String.check(Schema.isMinLength(1)),
        replace: Schema.String,
      }),
    ),
    () => [],
  ),
  creates: withDefault(
    Schema.Array(
      Schema.Struct({ path: Schema.String, content: Schema.String }),
    ),
    () => [],
  ),
});

export const GithubConfig = Schema.StructWithRest(
  Schema.Struct({
    repo: Schema.String.check(Schema.isPattern(/^[^/]+\/[^/]+$/)),
    base_branch: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("main")),
    ),
    branch_prefix: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("agent/proposal")),
    ),
    /** The fenced write surface. Empty (the default) proposes nothing. */
    allowed_prefixes: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export type { Cfg } from "./types.js";
