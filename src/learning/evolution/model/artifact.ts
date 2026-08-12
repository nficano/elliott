import * as Schema from "effect/Schema";

export class EvolutionToolDescriptionRevision
  extends Schema.Class<EvolutionToolDescriptionRevision>(
    "EvolutionToolDescriptionRevision",
  )({
    catalogDigest: Schema.String,
    snapshotId: Schema.String,
    descriptions: Schema.Record(
      Schema.String,
      Schema.Record(Schema.String, Schema.String),
    ),
    schemaDigests: Schema.Record(Schema.String, Schema.String),
    createdAt: Schema.String,
  })
{}

export class EvolutionPromptSourceRevision
  extends Schema.Class<EvolutionPromptSourceRevision>(
    "EvolutionPromptSourceRevision",
  )({
    sourceId: Schema.String,
    sourceDigest: Schema.String,
    snapshotId: Schema.String,
    purpose: Schema.String,
    trust: Schema.String,
    content: Schema.String,
    createdAt: Schema.String,
  })
{}
