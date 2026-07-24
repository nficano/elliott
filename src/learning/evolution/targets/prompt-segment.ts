import { constraintResult, validation } from "../constraints/common";
import type {
  EvolutionPromptCandidateInput,
  EvolutionTargetValidation,
} from "./types";

const MAXIMUM_TOKEN_RATIO = 1.2;
const FORBIDDEN_PURPOSES = new Set([
  "constitution",
  "runtime",
  "operator",
  "task",
  "evidence",
]);

const targetIsEligible = (input: EvolutionPromptCandidateInput): boolean =>
  input.baseline.evolution?.evolvable === true
  && input.baseline.evolution.authority !== "forbidden"
  && input.baseline.id !== undefined
  && input.baseline.id === input.candidate.id
  && JSON.stringify(input.baseline.evolution)
    === JSON.stringify(input.candidate.evolution);

const metadataIsPreserved = (input: EvolutionPromptCandidateInput): boolean =>
  input.baseline.purpose === input.candidate.purpose
  && input.baseline.trust === input.candidate.trust
  && input.baseline.classification === input.candidate.classification
  && JSON.stringify(input.baseline.securityTags)
    === JSON.stringify(input.candidate.securityTags);

const promptBindingResults = (
  input: EvolutionPromptCandidateInput,
): ReturnType<typeof constraintResult>[] => {
  const targetClassMatches = input.target.targetClass === "prompt-segment";
  const purposeAllowed = !FORBIDDEN_PURPOSES.has(input.baseline.purpose);
  const targetEligible = targetIsEligible(input);
  return [
    constraintResult(
      "prompt-target-class",
      targetClassMatches,
      targetClassMatches
        ? "target is bound to the prompt-segment adapter"
        : "non-prompt target was sent to the prompt adapter",
    ),
    constraintResult(
      "prompt-target-binding",
      targetEligible,
      targetEligible
        ? "stable target ID and evolution policy are unchanged"
        : "prompt is not evolvable or its target metadata changed",
    ),
    constraintResult(
      "prompt-purpose-allowlist",
      purposeAllowed,
      purposeAllowed
        ? "prompt purpose is eligible for evolution"
        : "prompt purpose is authority-bearing or dynamic",
    ),
  ];
};

const promptPreservationResults = (
  input: EvolutionPromptCandidateInput,
): ReturnType<typeof constraintResult>[] => {
  const metadataPreserved = metadataIsPreserved(input);
  const sourcePreserved = input.baseline.source === input.candidate.source;
  const maximumRatio = Math.min(
    MAXIMUM_TOKEN_RATIO,
    input.baseline.evolution?.maximumTokenRatio ?? MAXIMUM_TOKEN_RATIO,
  );
  const footprintPassed = input.candidateTokenCount
    <= input.baselineTokenCount * maximumRatio;
  return [
    constraintResult(
      "prompt-trust-order",
      metadataPreserved,
      metadataPreserved
        ? "purpose, trust, classification, and security tags are unchanged"
        : "candidate changed prompt authority metadata",
    ),
    constraintResult(
      "prompt-source",
      sourcePreserved,
      sourcePreserved
        ? "typed prompt source is unchanged"
        : "candidate moved the prompt cache/source boundary",
    ),
    constraintResult(
      "prompt-footprint",
      footprintPassed,
      `${input.candidateTokenCount}/${input.baselineTokenCount} tokens`,
    ),
  ];
};

export const validatePromptCandidate = (
  input: EvolutionPromptCandidateInput,
): EvolutionTargetValidation =>
  validation([
    ...promptBindingResults(input),
    ...promptPreservationResults(input),
  ]);
