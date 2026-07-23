import * as Schema from "effect/Schema";

export const ObserverReportSchema = Schema.Struct({
  trigger: Schema.Literals([
    "compounding_mistake",
    "missed_constraint",
    "prior_art",
  ]),
  message: Schema.String,
});

export const ProposalSchema = Schema.Struct({
  proposals: Schema.Array(
    Schema.Struct({
      type: Schema.Literals([
        "tool_prune",
        "routing",
        "prompt",
        "memory",
        "new_skill",
      ]),
      target: Schema.String,
      rationale: Schema.String,
      change: Schema.optionalKey(Schema.String),
      estSavingColdTokens: Schema.optionalKey(Schema.Number),
    }),
  ),
});
