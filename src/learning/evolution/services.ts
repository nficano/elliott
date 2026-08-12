import * as Context from "effect/Context";
import type { RecordAppender } from "../../core/waist/types";
import type { EvolutionConstraintEngineShape } from "./constraints/types";
import type { EvolutionHarnessShape } from "./evaluation/types";
import type { EvolutionOrchestratorShape } from "./orchestrator/types";
import type { EvolutionProposalAuthorShape } from "./release/types";
import type {
  EvolutionBenchmarkRunnerShape,
  EvolutionCandidateStoreShape,
  EvolutionDatasetBuilderShape,
  EvolutionDatasetStoreShape,
  EvolutionEvaluationReportStoreShape,
  EvolutionEvaluationRunnerShape,
  EvolutionReleaseProjectionShape,
  EvolutionReleaseStoreShape,
  EvolutionRunStoreShape,
  EvolutionTargetRegistryShape,
  OptimizationEngineShape,
} from "./types";

export class EvolutionRunStore extends Context.Service<
  EvolutionRunStore,
  EvolutionRunStoreShape
>()("elliott/evolution/EvolutionRunStore") {}

export class EvolutionCandidateStore extends Context.Service<
  EvolutionCandidateStore,
  EvolutionCandidateStoreShape
>()("elliott/evolution/EvolutionCandidateStore") {}

export class EvolutionDatasetStore extends Context.Service<
  EvolutionDatasetStore,
  EvolutionDatasetStoreShape
>()("elliott/evolution/EvolutionDatasetStore") {}

export class EvolutionReleaseStore extends Context.Service<
  EvolutionReleaseStore,
  EvolutionReleaseStoreShape
>()("elliott/evolution/EvolutionReleaseStore") {}

export class EvolutionEvaluationReportStore extends Context.Service<
  EvolutionEvaluationReportStore,
  EvolutionEvaluationReportStoreShape
>()("elliott/evolution/EvolutionEvaluationReportStore") {}

export class EvolutionTargetRegistry extends Context.Service<
  EvolutionTargetRegistry,
  EvolutionTargetRegistryShape
>()("elliott/evolution/EvolutionTargetRegistry") {}

export class OptimizationEngine extends Context.Service<
  OptimizationEngine,
  OptimizationEngineShape
>()("elliott/evolution/OptimizationEngine") {}

export class EvolutionDatasetBuilder extends Context.Service<
  EvolutionDatasetBuilder,
  EvolutionDatasetBuilderShape
>()("elliott/evolution/EvolutionDatasetBuilder") {}

export class EvolutionEvaluationRunner extends Context.Service<
  EvolutionEvaluationRunner,
  EvolutionEvaluationRunnerShape
>()("elliott/evolution/EvolutionEvaluationRunner") {}

export class EvolutionBenchmarkRunner extends Context.Service<
  EvolutionBenchmarkRunner,
  EvolutionBenchmarkRunnerShape
>()("elliott/evolution/EvolutionBenchmarkRunner") {}

export class EvolutionReleaseProjection extends Context.Service<
  EvolutionReleaseProjection,
  EvolutionReleaseProjectionShape
>()("elliott/evolution/EvolutionReleaseProjection") {}

export class EvolutionConstraintEngine extends Context.Service<
  EvolutionConstraintEngine,
  EvolutionConstraintEngineShape
>()("elliott/evolution/EvolutionConstraintEngine") {}

export class EvolutionEvaluationHarness extends Context.Service<
  EvolutionEvaluationHarness,
  EvolutionHarnessShape
>()("elliott/evolution/EvolutionEvaluationHarness") {}

export class EvolutionProposalAuthor extends Context.Service<
  EvolutionProposalAuthor,
  EvolutionProposalAuthorShape
>()("elliott/evolution/EvolutionProposalAuthor") {}

export class EvolutionRecordAppender extends Context.Service<
  EvolutionRecordAppender,
  RecordAppender
>()("elliott/evolution/EvolutionRecordAppender") {}

export class EvolutionOrchestrator extends Context.Service<
  EvolutionOrchestrator,
  EvolutionOrchestratorShape
>()("elliott/evolution/EvolutionOrchestrator") {}
