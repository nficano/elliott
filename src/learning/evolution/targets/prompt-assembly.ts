import { constraintResult, validation } from "../constraints/common";
import type {
  EvolutionPromptAssemblyCandidateInput,
  EvolutionTargetValidation,
} from "./types";

const segmentIds = (
  segments: EvolutionPromptAssemblyCandidateInput["baseline"]["segments"],
): string => JSON.stringify(segments.map((segment) => segment.id ?? null));

const unrelatedSegmentsPreserved = (
  input: EvolutionPromptAssemblyCandidateInput,
): boolean =>
  input.baseline.segments.every((baseline, index) => {
    if (baseline.id === input.targetSegmentId) return true;
    return JSON.stringify(baseline)
      === JSON.stringify(input.candidate.segments[index]);
  });

export const validatePromptAssemblyCandidate = (
  input: EvolutionPromptAssemblyCandidateInput,
): EvolutionTargetValidation => {
  const sequencePreserved = segmentIds(input.baseline.segments)
    === segmentIds(input.candidate.segments);
  const cacheBoundaryPreserved = input.baseline.cacheBreakpoint
      === input.candidate.cacheBreakpoint
    && segmentIds(input.baseline.stablePrefix)
      === segmentIds(input.candidate.stablePrefix);
  const unrelatedPreserved = unrelatedSegmentsPreserved(input);
  const snapshotsAreDistinct = input.baseline.snapshot
    !== input.candidate.snapshot;
  return validation([
    constraintResult(
      "prompt-segment-order",
      sequencePreserved,
      sequencePreserved
        ? "typed prompt segment order is unchanged"
        : "candidate moved, added, or removed a typed prompt segment",
    ),
    constraintResult(
      "prompt-cache-boundary",
      cacheBoundaryPreserved,
      cacheBoundaryPreserved
        ? "stable-prefix membership and cache breakpoint are unchanged"
        : "candidate moved the stable prompt cache boundary",
    ),
    constraintResult(
      "prompt-unrelated-segments",
      unrelatedPreserved,
      unrelatedPreserved
        ? "all unrelated prompt segments are byte-stable"
        : "candidate changed a prompt segment outside the target",
    ),
    constraintResult(
      "prompt-snapshot-isolation",
      snapshotsAreDistinct,
      snapshotsAreDistinct
        ? "candidate prompt is bound to a distinct Snapshot"
        : "candidate attempted an in-place prompt change",
    ),
  ]);
};
