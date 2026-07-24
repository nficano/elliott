import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionDecodeError } from "./errors";
import { EvolutionRiskClassSchema } from "./model/index";

export class EvolutionEngineSelection
  extends Schema.Class<EvolutionEngineSelection>("EvolutionEngineSelection")({
    primary: Schema.String,
    fallback: Schema.optionalKey(Schema.String),
  })
{}

export class EvolutionConfig extends Schema.Class<EvolutionConfig>(
  "EvolutionConfig",
)({
  apiVersion: Schema.Literal("elliott/v1"),
  engines: Schema.Struct({
    text: EvolutionEngineSelection,
    code: EvolutionEngineSelection,
  }),
  budgets: Schema.Struct({
    perRun: Schema.Struct({
      candidates: Schema.Int,
      tokens: Schema.Int,
      costUsd: Schema.Number,
      durationMinutes: Schema.Int,
    }),
    monthly: Schema.Struct({ costUsd: Schema.Number }),
  }),
  evaluation: Schema.Struct({
    authoringProfile: Schema.String,
    judgingProfile: Schema.String,
    requireDistinctRoute: Schema.Boolean,
    split: Schema.Struct({
      train: Schema.Number,
      validation: Schema.Number,
      holdout: Schema.Number,
    }),
  }),
  continuous: Schema.Struct({
    enabled: Schema.Boolean,
    benchmarkCron: Schema.String,
    optimizationCron: Schema.optionalKey(Schema.String),
    maximumRiskClass: EvolutionRiskClassSchema,
    maximumConcurrentRuns: Schema.Int,
  }),
  targets: Schema.Struct({
    allow: Schema.Array(Schema.String),
    deny: Schema.Array(Schema.String),
  }),
}) {}

const validateConfig = (
  config: EvolutionConfig,
): Effect.Effect<EvolutionConfig, EvolutionDecodeError> => {
  const split = config.evaluation.split;
  const splitTotal = split.train + split.validation + split.holdout;
  const invalid = [
    config.budgets.perRun.candidates <= 0,
    config.budgets.perRun.tokens <= 0,
    config.budgets.perRun.costUsd <= 0,
    config.budgets.perRun.durationMinutes <= 0,
    config.budgets.monthly.costUsd <= 0,
    config.continuous.maximumConcurrentRuns <= 0,
    split.train <= 0,
    split.validation <= 0,
    split.holdout <= 0,
    Math.abs(splitTotal - 1) > Number.EPSILON,
  ];
  return invalid.some(Boolean)
    ? EvolutionDecodeError.make({
      artifact: "evolution-config-policy",
      cause: "positive budgets and a unit split are required",
    })
    : Effect.succeed(config);
};

export const decodeEvolutionConfig = (
  input: unknown,
): Effect.Effect<EvolutionConfig, EvolutionDecodeError> =>
  Schema.decodeUnknownEffect(EvolutionConfig)(input).pipe(
    Effect.mapError((cause) =>
      EvolutionDecodeError.make({ artifact: "evolution-config", cause })
    ),
    Effect.flatMap(validateConfig),
  );

const matchesPattern = (pattern: string, targetRef: string): boolean => {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === targetRef;
  const [prefix = "", suffix = ""] = parts;
  return targetRef.startsWith(prefix) && targetRef.endsWith(suffix);
};

export const evolutionTargetAllowed = (
  config: EvolutionConfig,
  targetRef: string,
): boolean =>
  config.targets.allow.some((pattern) => matchesPattern(pattern, targetRef))
  && config.targets.deny.every((pattern) =>
    !matchesPattern(pattern, targetRef)
  );
