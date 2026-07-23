import * as Schema from "effect/Schema";

/** JSON-RPC 2.0 response envelope — the only shape either wire lets through. */
export const JsonRpcResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literals(["2.0"]),
  id: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Number, Schema.Null]),
  ),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
    }),
  ),
});

/** `tools/list` result slice — name/description/inputSchema/annotations. */
export const McpToolsListSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
      inputSchema: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Unknown),
      ),
      annotations: Schema.optionalKey(
        Schema.Struct({
          readOnlyHint: Schema.optionalKey(Schema.Boolean),
        }),
      ),
    }),
  ),
  nextCursor: Schema.optionalKey(Schema.String),
});

/** `tools/call` result slice — text content parts + the error flag. */
export const McpCallResultSchema = Schema.Struct({
  content: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  structuredContent: Schema.optionalKey(Schema.Unknown),
  isError: Schema.optionalKey(Schema.Boolean),
});
