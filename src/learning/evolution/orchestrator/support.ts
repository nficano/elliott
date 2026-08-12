import * as Effect from "effect/Effect";
import { scopeId } from "../../../core/brands";
import { EvolutionPersistenceError } from "../errors";
import {
  EvolutionBudgetUsage,
  EvolutionRun,
  EvolutionTransitionContext,
} from "../model/index";
import { evolutionRecordDurability } from "../records";
import type {
  EvolutionOrchestratorDependencies,
  EvolutionRecordInput,
} from "./types";

export const noEvolutionUsage = () =>
  EvolutionBudgetUsage.make({
    candidates: 0,
    tokens: 0,
    costUsd: 0,
    durationMilliseconds: 0,
    concurrency: 0,
  });

export const evolutionTransitionContext = (run: EvolutionRun, now: string) =>
  EvolutionTransitionContext.make({
    principalId: run.principalId,
    activeTargetDigest: run.target.baselineDigest,
    now,
    usage: noEvolutionUsage(),
  });

export const appendEvolutionRecord = (
  dependencies: EvolutionOrchestratorDependencies,
  input: EvolutionRecordInput,
) =>
  Effect.tryPromise({
    try: () =>
      dependencies.records.append({
        type: input.type,
        scope: { level: "principal", id: scopeId(input.run.principalId) },
        durability: evolutionRecordDurability(input.type),
        classification: "internal",
        payload: { runId: input.run.id, ...input.payload },
      }),
    catch: (cause) =>
      EvolutionPersistenceError.make({
        operation: "append-evolution-record",
        path: input.type,
        cause,
      }),
  }).pipe(Effect.asVoid);
