import * as Schema from "effect/Schema";

/**
 * Config slice for one `mcp.<id>` section — written by the spec compiler from
 * the agent file's `mcp:` block (`with:` keys land here verbatim).
 */
export const McpSectionConfigSchema = Schema.StructWithRest(
  Schema.Struct({
    enabled: Schema.optionalKey(Schema.Boolean),
    url: Schema.String,
    transport: Schema.optionalKey(
      Schema.Literals(["streamable-http", "sse"]),
    ),
    /** Router bundle the discovered tools join; defaults to "ops". */
    bundle: Schema.optionalKey(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
