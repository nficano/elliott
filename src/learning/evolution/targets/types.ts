import type { PromptAssembly, PromptSegment } from "../../../prompt/types";
import type {
  EvolutionConstraintResult,
  EvolutionTarget,
} from "../model/index";

export interface EvolutionTargetValidation {
  readonly results: readonly EvolutionConstraintResult[];
  readonly passed: boolean;
}

export interface EvolutionPathConstraintInput {
  readonly target: EvolutionTarget;
  readonly changedPaths: readonly string[];
}

export interface EvolutionSkillCandidateInput {
  readonly target: EvolutionTarget;
  readonly namespace: string;
  readonly baselineMarkdown: string;
  readonly candidateMarkdown: string;
  readonly baselineOverlayRaw?: string;
  readonly candidateOverlayRaw?: string;
  readonly maximumCharacters: number;
}

export interface EvolutionToolDescriptionCandidateInput {
  readonly target: EvolutionTarget;
  readonly baselineDescriptions: Readonly<Record<string, string>>;
  readonly candidateDescriptions: Readonly<Record<string, string>>;
  readonly baselineSchema: Readonly<Record<string, unknown>>;
  readonly candidateSchema: Readonly<Record<string, unknown>>;
  readonly topLevelDescriptionKey: string;
  readonly maximumTopLevelCharacters: number;
  readonly maximumParameterCharacters: number;
}

export interface EvolutionPromptCandidateInput {
  readonly target: EvolutionTarget;
  readonly baseline: PromptSegment;
  readonly candidate: PromptSegment;
  readonly baselineTokenCount: number;
  readonly candidateTokenCount: number;
}

export interface EvolutionPromptAssemblyCandidateInput {
  readonly baseline: PromptAssembly;
  readonly candidate: PromptAssembly;
  readonly targetSegmentId: string;
}

export interface EvolutionCodeCandidateInput {
  readonly target: EvolutionTarget;
  readonly changedPaths: readonly string[];
  readonly patch: string;
  readonly scheduled: boolean;
  readonly focusedTestPassed: boolean;
  readonly fullCheckPassed: boolean;
  readonly baselineSurface: EvolutionCodeFrozenSurface;
  readonly candidateSurface: EvolutionCodeFrozenSurface;
  readonly baselineErrorPathCoverage: number;
  readonly candidateErrorPathCoverage: number;
}

export interface EvolutionCodeFrozenSurface {
  readonly publicSignatures: readonly string[];
  readonly manifestDigest: string;
  readonly protocolSchemaDigests: readonly string[];
  readonly capabilities: readonly string[];
  readonly egressDestinations: readonly string[];
  readonly isolation: string;
  readonly securityCheckMarkers: readonly string[];
  readonly evaluatorFixtureDigests: readonly string[];
}

export interface EvolutionToolDatasetEntry {
  readonly toolRef: string;
  readonly description: string;
  readonly parameterNames: readonly string[];
  readonly positiveTasks: readonly string[];
}

export interface EvolutionCodeDefectCase {
  readonly id: string;
  readonly reproduction: string;
  readonly expectedBehavior: string;
  readonly sourceDigest: string;
}
