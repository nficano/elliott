import * as Schema from "effect/Schema";

export const MemoryRowSchema = Schema.Struct({
  collection: Schema.Literals([
    "episodic",
    "semantic",
    "learnings",
    "inner",
  ]),
  id: Schema.String,
  origin: Schema.Literals(["owner", "internal", "untrusted"]),
  embed_model: Schema.String,
  dim: Schema.Number,
  preview: Schema.String,
  body_ref: Schema.NullOr(Schema.String),
  created_at: Schema.Date,
  score: Schema.Union([Schema.String, Schema.Number]),
});
