import type { EvolutionCandidate } from "../model/index";

const constraintQuality = (candidate: EvolutionCandidate): number =>
  candidate.constraints.length === 0
    ? 0
    : candidate.constraints.filter((constraint) => constraint.passed).length
      / candidate.constraints.length;

export const evolutionCandidateFitness = (
  candidate: EvolutionCandidate,
) => ({
  quality: candidate.validationScore ?? constraintQuality(candidate),
  footprintCharacters: candidate.materializedContent?.length ?? Infinity,
  costUsd: candidate.usage.costUsd,
  latencyMilliseconds: candidate.usage.latencyMilliseconds,
});

export const evolutionCandidateDominates = (
  dominant: EvolutionCandidate,
  subordinate: EvolutionCandidate,
): boolean => {
  const left = evolutionCandidateFitness(dominant);
  const right = evolutionCandidateFitness(subordinate);
  const noWorse = left.quality >= right.quality
    && left.footprintCharacters <= right.footprintCharacters
    && left.costUsd <= right.costUsd
    && left.latencyMilliseconds <= right.latencyMilliseconds;
  const strictlyBetter = left.quality > right.quality
    || left.footprintCharacters < right.footprintCharacters
    || left.costUsd < right.costUsd
    || left.latencyMilliseconds < right.latencyMilliseconds;
  return noWorse && strictlyBetter;
};

export const paretoDominators = (
  candidate: EvolutionCandidate,
  candidates: readonly EvolutionCandidate[],
): readonly EvolutionCandidate[] =>
  candidates.filter((other) =>
    other.id !== candidate.id && evolutionCandidateDominates(other, candidate)
  );

const compareCandidates = (
  left: EvolutionCandidate,
  right: EvolutionCandidate,
): number => {
  const leftFitness = evolutionCandidateFitness(left);
  const rightFitness = evolutionCandidateFitness(right);
  return rightFitness.quality - leftFitness.quality
    || leftFitness.footprintCharacters - rightFitness.footprintCharacters
    || leftFitness.costUsd - rightFitness.costUsd
    || leftFitness.latencyMilliseconds - rightFitness.latencyMilliseconds
    || left.id.localeCompare(right.id);
};

export const paretoEvolutionShortlist = (
  candidates: readonly EvolutionCandidate[],
): readonly EvolutionCandidate[] =>
  candidates
    .filter((candidate) => paretoDominators(candidate, candidates).length === 0)
    .toSorted(compareCandidates);
