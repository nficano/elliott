import * as Schema from "effect/Schema";

const ContentBlockSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    tool_use_id: Schema.String,
    content: Schema.String,
    is_error: Schema.optional(Schema.Boolean),
  }),
]);

export const HistoryRowSchema = Schema.Struct({
  role: Schema.Literals(["system", "user", "assistant", "tool"]),
  content: Schema.Union([Schema.String, Schema.Array(ContentBlockSchema)]),
  origin: Schema.Literals(["owner", "internal", "untrusted"]),
});
