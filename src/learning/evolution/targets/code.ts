import {
  constraintResult,
  validateMutationPaths,
  validation,
} from "../constraints/common";
import type {
  EvolutionCodeCandidateInput,
  EvolutionTargetValidation,
} from "./types";

const UNSAFE_PATCH_PATTERNS = [
  /\bas\s+any\b/u,
  /@ts-ignore/u,
  /eslint-disable/u,
  /child_process/u,
  /docker\.sock/u,
  /\bwhile\s*\(\s*true\s*\)/u,
  /\bas\s+unknown\s+as\b/u,
  /\bfetch\s*\(/u,
  /\bnew\s+WebSocket\s*\(/u,
];

const canonicalStrings = (values: readonly string[]): string =>
  JSON.stringify(values.toSorted((left, right) => left.localeCompare(right)));

const frozenSurfacePreserved = (
  input: EvolutionCodeCandidateInput,
): boolean =>
  input.baselineSurface.manifestDigest
    === input.candidateSurface.manifestDigest
  && input.baselineSurface.isolation === input.candidateSurface.isolation
  && canonicalStrings(input.baselineSurface.publicSignatures)
    === canonicalStrings(input.candidateSurface.publicSignatures)
  && canonicalStrings(input.baselineSurface.protocolSchemaDigests)
    === canonicalStrings(input.candidateSurface.protocolSchemaDigests)
  && canonicalStrings(input.baselineSurface.capabilities)
    === canonicalStrings(input.candidateSurface.capabilities)
  && canonicalStrings(input.baselineSurface.evaluatorFixtureDigests)
    === canonicalStrings(input.candidateSurface.evaluatorFixtureDigests);

const securitySurfacePreserved = (
  input: EvolutionCodeCandidateInput,
): boolean =>
  canonicalStrings(input.baselineSurface.securityCheckMarkers)
    === canonicalStrings(input.candidateSurface.securityCheckMarkers)
  && canonicalStrings(input.baselineSurface.egressDestinations)
    === canonicalStrings(input.candidateSurface.egressDestinations);

const codeAuthorityResults = (
  input: EvolutionCodeCandidateInput,
): ReturnType<typeof constraintResult>[] => {
  const targetClassMatches = input.target.targetClass === "code";
  const riskSchedulingPassed = !input.scheduled
    || input.target.riskClass === "C1"
    || input.target.riskClass === "C2";
  const staticSafetyPassed = UNSAFE_PATCH_PATTERNS.every(
    (pattern) => !pattern.test(input.patch),
  );
  const securityPreserved = securitySurfacePreserved(input);
  return [
    constraintResult(
      "code-target-class",
      targetClassMatches,
      targetClassMatches
        ? "target is bound to the code adapter"
        : "non-code target was sent to the code adapter",
    ),
    constraintResult(
      "code-risk-scheduling",
      riskSchedulingPassed,
      riskSchedulingPassed
        ? "risk class permits the requested campaign mode"
        : "C3 and C4 campaigns require an operator start",
    ),
    constraintResult(
      "code-static-safety",
      staticSafetyPassed,
      staticSafetyPassed
        ? "no forbidden ambient-authority or unsafe construct was introduced"
        : "candidate contains a forbidden unsafe construct",
    ),
    constraintResult(
      "code-security-surface",
      securityPreserved,
      securityPreserved
        ? "security checks and network destinations are unchanged"
        : "candidate removed a security check or changed network authority",
    ),
  ];
};

const codePreservationResults = (
  input: EvolutionCodeCandidateInput,
): ReturnType<typeof constraintResult>[] => {
  const surfacePreserved = frozenSurfacePreserved(input);
  const coveragePreserved = input.candidateErrorPathCoverage
    >= input.baselineErrorPathCoverage;
  return [
    constraintResult(
      "code-frozen-surface",
      surfacePreserved,
      surfacePreserved
        ? "manifest, Protocols, signatures, capabilities, and fixtures match"
        : "candidate changed a frozen code-evolution surface",
    ),
    constraintResult(
      "code-error-path-coverage",
      coveragePreserved,
      coveragePreserved
        ? "error-path coverage is preserved"
        : "candidate decreased error-path coverage",
    ),
  ];
};

const codeExecutionResults = (
  input: EvolutionCodeCandidateInput,
): ReturnType<typeof constraintResult>[] => [
  constraintResult(
    "code-focused-test",
    input.focusedTestPassed,
    input.focusedTestPassed
      ? "focused defect reproduction passes"
      : "focused defect reproduction fails",
  ),
  constraintResult(
    "code-full-check",
    input.fullCheckPassed,
    input.fullCheckPassed
      ? "the complete Elliott check passes"
      : "a candidate that fails the complete check cannot be shortlisted",
  ),
];

export const validateCodeCandidate = (
  input: EvolutionCodeCandidateInput,
): EvolutionTargetValidation =>
  validation([
    ...validateMutationPaths({
      target: input.target,
      changedPaths: input.changedPaths,
    }),
    ...codeAuthorityResults(input),
    ...codePreservationResults(input),
    ...codeExecutionResults(input),
  ]);
