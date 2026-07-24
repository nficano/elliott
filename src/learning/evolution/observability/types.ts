import type {
  EvolutionCandidate,
  EvolutionDatasetManifest,
  EvolutionEvaluationReport,
  EvolutionRun,
} from "../model/index";

export interface EvolutionCandidateMetricInput {
  readonly targetClass: EvolutionRun["target"]["targetClass"];
  readonly candidate: EvolutionCandidate;
  readonly outcome: "shortlisted" | "rejected";
  readonly rejectionReason?: string;
}

export interface EvolutionDatasetMetricInput {
  readonly targetClass: EvolutionRun["target"]["targetClass"];
  readonly dataset: EvolutionDatasetManifest;
}

export interface EvolutionEvaluationMetricInput {
  readonly targetClass: EvolutionRun["target"]["targetClass"];
  readonly report: EvolutionEvaluationReport;
}
