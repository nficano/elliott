import * as Schema from "effect/Schema";

const PromptTokensDetailsSchema = Schema.Struct({
  cached_tokens: Schema.optionalKey(Schema.Number),
});

export const RawUsageSchema = Schema.Struct({
  prompt_tokens: Schema.optionalKey(Schema.Number),
  completion_tokens: Schema.optionalKey(Schema.Number),
  total_tokens: Schema.optionalKey(Schema.Number),
  cache_read_input_tokens: Schema.optionalKey(Schema.Number),
  cache_creation_input_tokens: Schema.optionalKey(Schema.Number),
  prompt_tokens_details: Schema.optionalKey(PromptTokensDetailsSchema),
});

export const WireToolCallRespSchema = Schema.Struct({
  id: Schema.String,
  function: Schema.Struct({
    name: Schema.String,
    arguments: Schema.String,
  }),
});

export const ChatCompletionSchema = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(Schema.NullOr(RawUsageSchema)),
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
        message: Schema.optionalKey(
          Schema.Struct({
            content: Schema.optionalKey(Schema.NullOr(Schema.String)),
            tool_calls: Schema.optionalKey(
              Schema.Array(WireToolCallRespSchema),
            ),
          }),
        ),
      }),
    ),
  ),
});

const ToolCallDeltaSchema = Schema.Struct({
  index: Schema.Number,
  id: Schema.optionalKey(Schema.String),
  function: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      arguments: Schema.optionalKey(Schema.String),
    }),
  ),
});

export const ChatChunkSchema = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  usage: Schema.optionalKey(Schema.NullOr(RawUsageSchema)),
  choices: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        finish_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
        delta: Schema.optionalKey(
          Schema.Struct({
            content: Schema.optionalKey(Schema.NullOr(Schema.String)),
            tool_calls: Schema.optionalKey(Schema.Array(ToolCallDeltaSchema)),
          }),
        ),
      }),
    ),
  ),
});

export const EmbedResponseSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({ embedding: Schema.Array(Schema.Number) }),
  ),
  model: Schema.optionalKey(Schema.String),
});
