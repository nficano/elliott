import type { Effect } from "effect";
import type { FileProposalStore } from "../../proposals/index";
import type { EvolutionControlAuthority } from "../cli/types";
import type { EvolutionConfig } from "../config";
import type { EvolutionProjectionStore } from "../continuous/types";
import type { EvolutionSyntheticCaseGenerator } from "../datasets/sources/types";
import type { EvolutionDatasetError } from "../errors";
import type {
  EvolutionBaselineReport,
  EvolutionBaselineRequest,
  EvolutionCandidate,
  EvolutionCodeSandboxContract,
  EvolutionComparisonRequest,
  EvolutionDatasetManifest,
  EvolutionEvaluationReport,
  EvolutionRelease,
  EvolutionRun,
  EvolutionTarget,
} from "../model/index";
import type { EvolutionOrchestratorShape } from "../orchestrator/types";
import type {
  EvolutionCandidateStoreShape,
  EvolutionDatasetStoreShape,
  EvolutionEvaluationReportStoreShape,
  EvolutionReleaseStoreShape,
  EvolutionRunStoreShape,
  EvolutionWorkflowError,
} from "../types";

export interface EvolutionTargetMaterialization {
  readonly target: EvolutionTarget;
  readonly baselineContent: string;
  readonly codeSandbox?: EvolutionCodeSandboxContract;
}

export interface FileEvolutionCodeSandboxInput {
  readonly componentRef: string;
  readonly checkoutPaths: readonly string[];
  readonly targetFiles: readonly string[];
  readonly testCommands: readonly (readonly string[])[];
  readonly cpuQuota: number;
  readonly memoryMb: number;
  readonly pids: number;
  readonly timeoutMilliseconds: number;
  readonly activeContent?: string;
  readonly resolveFile: (
    file: string,
  ) => Effect.Effect<string, EvolutionWorkflowError>;
}

export interface EvolutionDatasetSourceResolverInput {
  readonly target: EvolutionTarget;
  readonly source: string;
  readonly resolveFile: (
    file: string,
  ) => Effect.Effect<string, EvolutionDatasetError>;
  readonly sessionDatabase?: string;
  readonly syntheticGenerator: EvolutionSyntheticCaseGenerator;
}

export interface EvolutionTargetCatalogShape {
  readonly resolve: (
    targetRef: string,
  ) => Effect.Effect<EvolutionTargetMaterialization, EvolutionWorkflowError>;
  readonly activeDigest: (
    targetRef: string,
  ) => Effect.Effect<string, EvolutionWorkflowError>;
}

export interface EvolutionActiveTargetReader {
  readonly contentForTarget: (
    targetRef: string,
  ) => { readonly digest: string; readonly content: string; } | undefined;
}

export interface EvolutionDatasetFactoryShape {
  readonly build: (
    target: EvolutionTarget,
    sources: readonly string[],
    seed: number,
  ) => Effect.Effect<EvolutionDatasetManifest, EvolutionWorkflowError>;
}

export interface EvolutionIndependentEvaluatorShape {
  readonly baseline: (
    request: EvolutionBaselineRequest,
  ) => Effect.Effect<EvolutionBaselineReport, EvolutionWorkflowError>;
  readonly compare: (
    request: EvolutionComparisonRequest,
  ) => Effect.Effect<EvolutionEvaluationReport, EvolutionWorkflowError>;
}

export interface EvolutionBaselineControllerShape {
  readonly measure: (
    input: {
      readonly run: EvolutionRun;
      readonly dataset: EvolutionDatasetManifest;
      readonly baselineContent: string;
      readonly seed: number;
    },
  ) => Effect.Effect<EvolutionBaselineReport, EvolutionWorkflowError>;
}

export interface EvolutionEvaluationRequestFactoryShape {
  readonly build: (
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    dataset: EvolutionDatasetManifest,
  ) => Effect.Effect<EvolutionComparisonRequest, EvolutionWorkflowError>;
}

export interface EvolutionReleaseControllerShape {
  readonly promote: (
    proposalId: string,
    authority: EvolutionControlAuthority,
  ) => Effect.Effect<EvolutionRelease, EvolutionWorkflowError>;
  readonly rollback: (
    releaseId: string,
    authority: EvolutionControlAuthority,
  ) => Effect.Effect<EvolutionRelease, EvolutionWorkflowError>;
}

export interface EvolutionOperatorApplicationInput {
  readonly config: EvolutionConfig;
  readonly configurationDigest: string;
  readonly orchestrator: EvolutionOrchestratorShape;
  readonly runs: EvolutionRunStoreShape;
  readonly candidates: EvolutionCandidateStoreShape;
  readonly datasets: EvolutionDatasetStoreShape;
  readonly reports: EvolutionEvaluationReportStoreShape;
  readonly releases: EvolutionReleaseStoreShape;
  readonly proposalStore: FileProposalStore;
  readonly targets: EvolutionTargetCatalogShape;
  readonly datasetFactory: EvolutionDatasetFactoryShape;
  readonly evaluationRequestFactory: EvolutionEvaluationRequestFactoryShape;
  readonly evaluator: EvolutionIndependentEvaluatorShape;
  readonly baselineController: EvolutionBaselineControllerShape;
  readonly releaseController: EvolutionReleaseControllerShape;
  readonly projections?: EvolutionProjectionStore;
  readonly now?: () => string;
  readonly randomSeed?: () => number;
}

export interface EvolutionRunResult {
  readonly runId: string;
  readonly state: string;
  readonly candidateIds: readonly string[];
}

export interface EvolutionParsedArguments {
  readonly positionals: readonly string[];
  readonly options: Readonly<Record<string, readonly string[]>>;
}

export interface EvolutionApplicationSelection {
  readonly candidate: EvolutionCandidate;
  readonly report: EvolutionEvaluationReport;
}
