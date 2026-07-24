import * as Schema from "effect/Schema";

export const EvolutionRunIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evr_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionRunId"),
);
export const EvolutionCandidateIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evc_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionCandidateId"),
);
export const EvolutionDatasetIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evd_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionDatasetId"),
);
export const EvolutionEvaluationReportIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^eve_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionEvaluationReportId"),
);
export const EvolutionBaselineReportIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evb_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionBaselineReportId"),
);
export const EvolutionReleaseMonitorReportIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evm_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionReleaseMonitorReportId"),
);
export const EvolutionReleaseIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^evl_[a-z0-9][a-z0-9_-]{7,127}$/)),
  Schema.brand("EvolutionReleaseId"),
);

export const EvolutionTargetClassSchema = Schema.Literals([
  "skill",
  "tool-description",
  "prompt-segment",
  "code",
]);

export const EvolutionRiskClassSchema = Schema.Literals([
  "C1",
  "C2",
  "C3",
  "C4",
]);

export const EvolutionEngineKindSchema = Schema.Literals([
  "gepa",
  "miprov2",
  "darwinian",
  "fixture",
]);

export const EvolutionClassificationSchema = Schema.Literals([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export const EvolutionDatasetSplitSchema = Schema.Literals([
  "train",
  "validation",
  "holdout",
]);

export const EvolutionMetricDirectionSchema = Schema.Literals([
  "maximize",
  "minimize",
]);

export const EvolutionBenchmarkScopeSchema = Schema.Literals([
  "candidate",
  "shortlist",
  "release",
]);
