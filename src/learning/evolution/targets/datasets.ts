import * as Effect from "effect/Effect";
import { EvolutionDatasetError } from "../errors";
import { EvolutionUnsplitDatasetCase } from "../model/index";
import type {
  EvolutionTargetClassSchema,
  EvolutionUnsplitDatasetCase as EvolutionUnsplitDatasetCaseType,
} from "../model/index";
import { PROMPT_BEHAVIOR_SCENARIOS } from "./prompt-scenarios";
import type {
  EvolutionCodeDefectCase,
  EvolutionToolDatasetEntry,
} from "./types";

const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const CODE_TIMEOUT_MILLISECONDS = 120_000;
const TOOL_AMBIGUOUS_CASES = 10;
const TOOL_NO_TOOL_CASES = 10;
const MINIMUM_POSITIVE_TOOL_CASES = 10;
const MINIMUM_TOOL_DATASET_CASES = 200;
const MAXIMUM_TOOL_DATASET_CASES = 400;
const MINIMUM_SKILL_DATASET_CASES = 15;
const MAXIMUM_SKILL_DATASET_CASES = 30;
const MINIMUM_PROMPT_DATASET_CASES = 60;
const MAXIMUM_PROMPT_DATASET_CASES = 80;

const positiveToolCases = (
  entries: readonly EvolutionToolDatasetEntry[],
): readonly EvolutionUnsplitDatasetCase[] =>
  entries.flatMap((entry) =>
    entry.positiveTasks.map((task, index) =>
      EvolutionUnsplitDatasetCase.make({
        id: `tool-positive-${entry.toolRef}-${index}`,
        groupId: `tool-${entry.toolRef}-${index}`,
        input: { task, catalog: entries.map((item) => item.toolRef) },
        expected: {
          toolRef: entry.toolRef,
          requiredParameters: entry.parameterNames,
        },
        classification: "internal",
        sourceDigests: [],
        timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
        maximumCostUsd: 0,
        allowedEffects: [],
      })
    )
  );

const ambiguousToolCases = (
  entries: readonly EvolutionToolDatasetEntry[],
): readonly EvolutionUnsplitDatasetCase[] => {
  if (entries.length < 2) return [];
  return Array.from({ length: TOOL_AMBIGUOUS_CASES }, (_, index) => {
    const entry = entries[index % entries.length]!;
    const peer = entries[(index + 1) % entries.length]!;
    return EvolutionUnsplitDatasetCase.make({
      id: `tool-ambiguous-${index}`,
      groupId: `tool-ambiguous-${index}`,
      input: {
        task: `Distinguish ${entry.toolRef} from ${peer.toolRef} in scenario ${
          index + 1
        }.`,
        candidates: [entry.toolRef, peer.toolRef],
      },
      expected: { compareSemantics: true },
      rubric: "Select only when one description materially matches the task.",
      classification: "internal",
      sourceDigests: [],
      timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
      maximumCostUsd: 0,
      allowedEffects: [],
    });
  });
};

const noToolCases = (): readonly EvolutionUnsplitDatasetCase[] =>
  Array.from(
    { length: TOOL_NO_TOOL_CASES },
    (_, index) =>
      EvolutionUnsplitDatasetCase.make({
        id: `tool-none-${index}`,
        groupId: `tool-none-${index}`,
        input: {
          task: `Answer conversational request ${
            index + 1
          } without invoking a tool.`,
        },
        expected: { toolRef: null },
        classification: "internal",
        sourceDigests: [],
        timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
        maximumCostUsd: 0,
        allowedEffects: [],
      }),
  );

export const toolSelectionDatasetCases = (
  entries: readonly EvolutionToolDatasetEntry[],
): readonly EvolutionUnsplitDatasetCase[] => [
  ...positiveToolCases(entries),
  ...ambiguousToolCases(entries),
  ...noToolCases(),
];

export const promptBehaviorDatasetCases = (
  sourceDigest: string,
): readonly EvolutionUnsplitDatasetCase[] =>
  [...PROMPT_BEHAVIOR_SCENARIOS].flatMap(([category, tasks]) =>
    tasks.map((task, index) =>
      EvolutionUnsplitDatasetCase.make({
        id: `prompt-${category}-${index}`,
        groupId: `prompt-${category}-${index}`,
        input: { category, task },
        expected: { preserveTrustOrder: true, preserveAuthority: true },
        classification: "internal",
        sourceDigests: [sourceDigest],
        timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
        maximumCostUsd: 0,
        allowedEffects: [],
      })
    )
  );

export const codeDefectDatasetCases = (
  defects: readonly EvolutionCodeDefectCase[],
): readonly EvolutionUnsplitDatasetCase[] =>
  defects.map((defect) =>
    EvolutionUnsplitDatasetCase.make({
      id: `code-${defect.id}`,
      groupId: `defect-${defect.id}`,
      input: { reproduction: defect.reproduction },
      expected: { behavior: defect.expectedBehavior },
      classification: "internal",
      sourceDigests: [defect.sourceDigest],
      timeoutMilliseconds: CODE_TIMEOUT_MILLISECONDS,
      maximumCostUsd: 0,
      allowedEffects: ["process.execute:test-allowlist"],
    })
  );

const expectedToolRef = (
  item: EvolutionUnsplitDatasetCaseType,
): string | null | undefined => {
  if (!hasToolRef(item.expected)) return undefined;
  const value = item.expected.toolRef;
  return typeof value === "string" || value === null ? value : undefined;
};

const hasToolRef = (
  value: unknown,
): value is Readonly<Record<"toolRef", unknown>> =>
  typeof value === "object"
  && value !== null
  && !Array.isArray(value)
  && Object.hasOwn(value, "toolRef");

const validToolVolume = (
  cases: readonly EvolutionUnsplitDatasetCaseType[],
): boolean => {
  const positiveCounts = new Map<string, number>();
  for (const item of cases) {
    const reference = expectedToolRef(item);
    if (typeof reference === "string") {
      positiveCounts.set(reference, (positiveCounts.get(reference) ?? 0) + 1);
    }
  }
  const ambiguous =
    cases.filter((item) => item.id.startsWith("tool-ambiguous-")).length;
  const noTool = cases.filter((item) => expectedToolRef(item) === null).length;
  return cases.length >= MINIMUM_TOOL_DATASET_CASES
    && cases.length <= MAXIMUM_TOOL_DATASET_CASES
    && positiveCounts.size > 0
    && [...positiveCounts.values()].every(
      (count) => count >= MINIMUM_POSITIVE_TOOL_CASES,
    )
    && ambiguous >= TOOL_AMBIGUOUS_CASES
    && noTool >= TOOL_NO_TOOL_CASES;
};

const validInitialVolume = (
  targetClass: typeof EvolutionTargetClassSchema.Type,
  cases: readonly EvolutionUnsplitDatasetCaseType[],
): boolean => {
  if (targetClass === "skill") {
    return cases.length >= MINIMUM_SKILL_DATASET_CASES
      && cases.length <= MAXIMUM_SKILL_DATASET_CASES;
  }
  if (targetClass === "tool-description") return validToolVolume(cases);
  if (targetClass === "prompt-segment") {
    return cases.length >= MINIMUM_PROMPT_DATASET_CASES
      && cases.length <= MAXIMUM_PROMPT_DATASET_CASES;
  }
  return cases.length > 0;
};

export const validateInitialDatasetVolume = Effect.fn(
  "validateInitialDatasetVolume",
)(function*(
  targetClass: typeof EvolutionTargetClassSchema.Type,
  cases: readonly EvolutionUnsplitDatasetCaseType[],
) {
  if (!validInitialVolume(targetClass, cases)) {
    return yield* EvolutionDatasetError.make({
      operation: "validate-initial-volume",
      reason: `initial ${targetClass} dataset does not meet campaign policy`,
      caseIds: cases.map((item) => item.id),
    });
  }
});
