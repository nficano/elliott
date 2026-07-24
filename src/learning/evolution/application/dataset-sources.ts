/* eslint-disable max-lines, max-lines-per-function, unicorn/no-nested-ternary, sonarjs/no-nested-conditional, unicorn/no-declarations-before-early-exit */
import * as Effect from "effect/Effect";
import { readFile } from "node:fs/promises";
import { hashBytes, hashValue } from "../../../core/digest";
import { SessionStore } from "../../../memory/session-store/index";
import { isJsonRecord } from "../../../providers/http";
import type { ToolDefinition } from "../../../runtime/types";
import {
  benchmarkDerivedDatasetSource,
  generateSyntheticDatasetSource,
  loadGoldenDatasetSource,
  sessionDerivedDatasetSourceFromStore,
  targetSpecificDatasetSource,
} from "../datasets/sources/index";
import type {
  EvolutionDatasetSourceResult,
  EvolutionSyntheticCaseGenerator,
} from "../datasets/sources/types";
import { EvolutionDatasetError } from "../errors";
import {
  type EvolutionTarget,
  EvolutionUnsplitDatasetCase,
} from "../model/index";
import {
  promptBehaviorDatasetCases,
  toolSelectionDatasetCases,
} from "../targets/datasets";
import type { EvolutionToolDatasetEntry } from "../targets/types";
import type { EvolutionDatasetSourceResolverInput } from "./types";

const SKILL_BOOTSTRAP_CASES = 20;
const TOOL_BOOTSTRAP_CASES = 200;
const PROMPT_BOOTSTRAP_CASES = 60;
const CODE_BOOTSTRAP_CASES = 3;
const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const CODE_TIMEOUT_MILLISECONDS = 120_000;
const TOOL_AMBIGUOUS_CASES = 10;
const TOOL_NO_TOOL_CASES = 10;
const TOOL_NON_POSITIVE_CASES = TOOL_AMBIGUOUS_CASES + TOOL_NO_TOOL_CASES;
const MINIMUM_POSITIVE_CASES_PER_TOOL = 10;

const parameterNames = (tool: ToolDefinition): readonly string[] => {
  const properties = tool.inputSchema["properties"];
  return isJsonRecord(properties)
    ? Object.keys(properties).toSorted((left, right) =>
      left.localeCompare(right)
    )
    : [];
};

export const makeRuntimeToolDatasetEntries = (
  tools: readonly ToolDefinition[],
): readonly EvolutionToolDatasetEntry[] =>
  [...tools]
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((tool) => ({
      toolRef: tool.name,
      description: tool.description,
      parameterNames: parameterNames(tool),
      positiveTasks: [],
    }));

const sizedToolEntries = (
  entries: readonly EvolutionToolDatasetEntry[],
  requestedCount: number,
): readonly EvolutionToolDatasetEntry[] => {
  const positiveCount = Math.max(0, requestedCount - TOOL_NON_POSITIVE_CASES);
  const majorCount = Math.min(
    entries.length,
    Math.floor(positiveCount / MINIMUM_POSITIVE_CASES_PER_TOOL),
  );
  return entries.map((entry, index) => {
    const count = index >= majorCount || majorCount === 0
      ? 0
      : Math.floor(positiveCount / majorCount)
        + (index < positiveCount % majorCount ? 1 : 0);
    return {
      ...entry,
      positiveTasks: Array.from(
        { length: count },
        (_, caseIndex) =>
          `Use ${entry.toolRef} for matching scenario ${
            caseIndex + 1
          }: ${entry.description}`,
      ),
    };
  });
};

const bootstrapCount = (target: EvolutionTarget): number => {
  if (target.targetClass === "skill") return SKILL_BOOTSTRAP_CASES;
  if (target.targetClass === "tool-description") {
    return TOOL_BOOTSTRAP_CASES;
  }
  if (target.targetClass === "prompt-segment") {
    return PROMPT_BOOTSTRAP_CASES;
  }
  return CODE_BOOTSTRAP_CASES;
};

const basicCase = (
  target: EvolutionTarget,
  index: number,
): EvolutionUnsplitDatasetCase =>
  EvolutionUnsplitDatasetCase.make({
    id: `${target.targetClass}-synthetic-${index}`,
    groupId: `${target.componentRef}-synthetic-${index}`,
    input: {
      task: `Exercise ${target.componentRef} behavior ${index + 1}.`,
      targetClass: target.targetClass,
    },
    expected: {
      preservePurpose: true,
      deterministicOutcome: true,
    },
    rubric: "Preserve the target purpose while improving the named behavior.",
    classification: "internal",
    sourceDigests: [target.baselineDigest],
    timeoutMilliseconds: target.targetClass === "code"
      ? CODE_TIMEOUT_MILLISECONDS
      : DEFAULT_TIMEOUT_MILLISECONDS,
    maximumCostUsd: 0,
    allowedEffects: target.targetClass === "code"
      ? ["process.execute:test-allowlist"]
      : [],
  });

const toolCase = (
  target: EvolutionTarget,
  index: number,
  count: number,
): EvolutionUnsplitDatasetCase => {
  const noToolStart = count - TOOL_NO_TOOL_CASES;
  const ambiguousStart = noToolStart - TOOL_AMBIGUOUS_CASES;
  const kind = index >= noToolStart
    ? "none"
    : index >= ambiguousStart
    ? "ambiguous"
    : "positive";
  return EvolutionUnsplitDatasetCase.make({
    id: kind === "none"
      ? `tool-none-${index - noToolStart}`
      : kind === "ambiguous"
      ? `tool-ambiguous-${index - ambiguousStart}`
      : `tool-positive-${target.componentRef}-${index}`,
    groupId: `tool-synthetic-${index}`,
    input: {
      task: kind === "none"
        ? `Answer conversational request ${index + 1} without a tool.`
        : kind === "ambiguous"
        ? `Choose ${target.componentRef} only when its contract is a better match than a similar tool in ambiguity scenario ${
          index - ambiguousStart + 1
        }.`
        : `Use ${target.componentRef} for matching task ${index + 1}.`,
    },
    expected: kind === "none"
      ? { toolRef: null }
      : kind === "ambiguous"
      ? { compareSemantics: true }
      : { toolRef: target.componentRef, requiredParameters: [] },
    ...(kind === "ambiguous" && {
      rubric: "Resolve tool ambiguity from the model-facing contracts.",
    }),
    classification: "internal",
    sourceDigests: [target.baselineDigest],
    timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
    maximumCostUsd: 0,
    allowedEffects: [],
  });
};

export const makeDeterministicEvolutionSyntheticGenerator = (
  toolEntries: readonly EvolutionToolDatasetEntry[] = [],
): EvolutionSyntheticCaseGenerator => ({
  generate: (target, requestedCount) => {
    const count = requestedCount > 0
      ? requestedCount
      : bootstrapCount(target);
    if (target.targetClass === "prompt-segment") {
      return Effect.succeed(
        promptBehaviorDatasetCases(target.baselineDigest).slice(0, count),
      );
    }
    if (target.targetClass === "tool-description" && toolEntries.length > 0) {
      return Effect.succeed(
        toolSelectionDatasetCases(
          sizedToolEntries(toolEntries, count),
        ).map((item) =>
          EvolutionUnsplitDatasetCase.make({
            ...item,
            sourceDigests: [target.baselineDigest],
          })
        ),
      );
    }
    return Effect.succeed(
      Array.from(
        { length: count },
        (_, index) =>
          target.targetClass === "tool-description"
            ? toolCase(target, index, count)
            : basicCase(target, index),
      ),
    );
  },
});

const parsePositiveInteger = (
  source: string,
  value: string | undefined,
  fallback: number,
): Effect.Effect<number, EvolutionDatasetError> => {
  if (value === undefined || value.length === 0) {
    return Effect.succeed(fallback);
  }
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0
    ? Effect.succeed(count)
    : EvolutionDatasetError.make({
      operation: "parse-dataset-source",
      reason: `${source} requires a positive integer case count`,
      caseIds: [],
    });
};

const benchmarkSource = (
  source: string,
): Effect.Effect<EvolutionDatasetSourceResult, EvolutionDatasetError> => {
  const specification = source.slice("benchmark:".length);
  const [benchmarkRef, rawTasks] = specification.split("#", 2);
  const taskIds =
    rawTasks?.split(",").map((item) => item.trim()).filter(Boolean)
      ?? [];
  if (benchmarkRef === undefined || benchmarkRef.length === 0) {
    return EvolutionDatasetError.make({
      operation: "parse-benchmark-source",
      reason: "benchmark source requires benchmark:<ref>#<task-id,...>",
      caseIds: [],
    });
  }
  const resolvedTasks = taskIds.length > 0 ? taskIds : ["bootstrap"];
  return Effect.succeed(benchmarkDerivedDatasetSource({
    benchmarkRef,
    taskIds: resolvedTasks,
    sourceDigest: hashValue({ benchmarkRef, taskIds: resolvedTasks }),
    classification: "internal",
  }));
};

const fileDatasetSource = Effect.fn("resolveFileEvolutionDatasetSource")(
  function*(
    input: EvolutionDatasetSourceResolverInput,
    source: string,
    targetSpecific: boolean,
  ) {
    const filePath = yield* input.resolveFile(source);
    const sourceDigest = hashBytes(
      yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf8"),
        catch: (cause) =>
          EvolutionDatasetError.make({
            operation: "digest-dataset-source",
            reason: String(cause),
            caseIds: [],
          }),
      }),
    );
    const golden = yield* loadGoldenDatasetSource({
      filePath,
      classification: "internal",
      sourceDigest,
    });
    return targetSpecific
      ? targetSpecificDatasetSource(
        input.target.componentRef,
        sourceDigest,
        golden.cases,
      )
      : golden;
  },
);

export const resolveEvolutionDatasetSource = Effect.fn(
  "resolveEvolutionDatasetSource",
)(function*(input: EvolutionDatasetSourceResolverInput) {
  if (input.source === "synthetic" || input.source.startsWith("synthetic:")) {
    const count = yield* parsePositiveInteger(
      input.source,
      input.source.split(":", 2)[1],
      bootstrapCount(input.target),
    );
    return yield* generateSyntheticDatasetSource(
      input.target,
      count,
      input.syntheticGenerator,
    );
  }
  if (input.source === "session") {
    if (input.sessionDatabase === undefined) {
      return yield* EvolutionDatasetError.make({
        operation: "resolve-session-source",
        reason: "session-derived source is not configured",
        caseIds: [],
      });
    }
    const store = new SessionStore(input.sessionDatabase);
    try {
      return sessionDerivedDatasetSourceFromStore({
        targetRef: input.target.componentRef,
        classification: "internal",
        sourceDigest: hashValue({
          database: input.sessionDatabase,
          targetRef: input.target.componentRef,
          feedback: store.evolution.feedbackForTarget(
            input.target.componentRef,
          ).map((item) => [item.id, item.evidenceDigest]),
        }),
        store: store.evolution,
      });
    } finally {
      store.close();
    }
  }
  if (input.source.startsWith("benchmark:")) {
    return yield* benchmarkSource(input.source);
  }
  if (input.source.startsWith("target-specific:")) {
    return yield* fileDatasetSource(
      input,
      input.source.slice("target-specific:".length),
      true,
    );
  }
  return yield* fileDatasetSource(
    input,
    input.source.startsWith("golden:")
      ? input.source.slice("golden:".length)
      : input.source,
    false,
  );
});
