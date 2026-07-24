import {
  EvolutionBenchmarkOperation,
  EvolutionTargetClassSchema,
} from "../model/index";
import type {
  EvolutionBenchmarkGateDefinition,
  EvolutionBenchmarkStage,
  EvolutionBenchmarkStageFactoryInput,
} from "./types";

const ALL_TARGET_CLASSES = EvolutionTargetClassSchema.literals;

export const REQUIRED_PREPROMOTION_BENCHMARK_GATES:
  readonly EvolutionBenchmarkGateDefinition[] = Object.freeze([
    {
      benchmarkRef: "target-syntax",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "immutable-field-check",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "permission-and-containment",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "static-security",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "focused-contract-tests",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "elliott-check",
      operation: "runFull",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "tblite-fast",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "task-specific-subset",
      operation: "runSubset",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "task-specific-validation",
      operation: "runFull",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "independent-holdout",
      operation: "compareBaseline",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "tblite-full",
      operation: "runFull",
      targetClasses: ALL_TARGET_CLASSES,
    },
    {
      benchmarkRef: "yc-bench",
      operation: "runFull",
      targetClasses: ["prompt-segment", "code"],
    },
    {
      benchmarkRef: "terminalbench2",
      operation: "runFull",
      targetClasses: ["code"],
    },
  ]);

export const makeRequiredBenchmarkStages = (
  input: EvolutionBenchmarkStageFactoryInput,
): readonly EvolutionBenchmarkStage[] =>
  REQUIRED_PREPROMOTION_BENCHMARK_GATES.map((gate) => {
    const applicable = gate.targetClasses.includes(input.targetClass);
    return {
      benchmarkRef: gate.benchmarkRef,
      applicable,
      ...(!applicable && {
        notApplicableReason:
          `${gate.benchmarkRef} does not apply to ${input.targetClass}`,
      }),
      run: (run, candidate, context) =>
        input.runner.invoke(EvolutionBenchmarkOperation.make({
          operation: gate.operation,
          run,
          candidate,
          benchmarkRef: gate.benchmarkRef,
          baselineSnapshotId: context.baselineSnapshotId,
          candidateSnapshotId: context.candidateSnapshotId,
          environmentDigest: context.environmentDigest,
          seed: context.seed,
          timeoutMilliseconds: context.timeoutMilliseconds,
          maximumCostUsd: context.maximumCostUsd,
        })),
    };
  });
