import { constraintResult, validation } from "../constraints/common";
import type {
  EvolutionTargetValidation,
  EvolutionToolDescriptionCandidateInput,
} from "./types";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return `{${
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")
  }}`;
};

const toolIdentityResults = (
  input: EvolutionToolDescriptionCandidateInput,
): ReturnType<typeof constraintResult>[] => {
  const baselineKeys = Object.keys(input.baselineDescriptions).toSorted(
    (left, right) => left.localeCompare(right),
  );
  const candidateKeys = Object.keys(input.candidateDescriptions).toSorted(
    (left, right) => left.localeCompare(right),
  );
  const keysPreserved = JSON.stringify(baselineKeys)
    === JSON.stringify(candidateKeys);
  const schemaPreserved = canonical(input.baselineSchema)
    === canonical(input.candidateSchema);
  const targetClassMatches = input.target.targetClass === "tool-description";
  return [
    constraintResult(
      "tool-target-class",
      targetClassMatches,
      targetClassMatches
        ? "target is bound to the tool-description adapter"
        : "non-tool target was sent to the tool-description adapter",
    ),
    constraintResult(
      "tool-schema-equivalence",
      schemaPreserved,
      schemaPreserved
        ? "operation and parameter schemas are unchanged"
        : "candidate changed a tool schema",
    ),
    constraintResult(
      "tool-description-keys",
      keysPreserved,
      keysPreserved
        ? "tool and parameter names are unchanged"
        : "candidate added or removed a description key",
    ),
  ];
};

const toolFootprintResult = (
  input: EvolutionToolDescriptionCandidateInput,
) => {
  const descriptionsWithinLimits = Object.entries(
    input.candidateDescriptions,
  ).every(([key, description]) =>
    description.length <= (
      key === input.topLevelDescriptionKey
        ? input.maximumTopLevelCharacters
        : input.maximumParameterCharacters
    )
  );
  return constraintResult(
    "tool-description-footprint",
    descriptionsWithinLimits,
    descriptionsWithinLimits
      ? "all descriptions are within configured limits"
      : "one or more descriptions exceed configured limits",
  );
};

export const validateToolDescriptionCandidate = (
  input: EvolutionToolDescriptionCandidateInput,
): EvolutionTargetValidation =>
  validation([
    ...toolIdentityResults(input),
    toolFootprintResult(input),
  ]);
