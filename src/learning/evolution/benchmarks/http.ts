import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionEvaluationError } from "../errors";
import { EvolutionBenchmarkResult } from "../model/index";
import type { EvolutionBenchmarkRunnerShape } from "../types";

export const makeHttpEvolutionBenchmarkRunner = (
  endpoint: string,
  fetcher: typeof globalThis.fetch = fetch,
): EvolutionBenchmarkRunnerShape => ({
  invoke: (operation) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetcher(
          new URL("/v1/run", endpoint),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(operation),
          },
        );
        if (!response.ok) {
          throw new Error(
            `Benchmark companion returned HTTP ${response.status}`,
          );
        }
        return response.json();
      },
      catch: (cause) =>
        EvolutionEvaluationError.make({
          evaluatorRef: "organization/evaluator/agent-benchmarks",
          operation: operation.operation,
          cause,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(EvolutionBenchmarkResult)),
      Effect.mapError((cause) =>
        cause instanceof EvolutionEvaluationError
          ? cause
          : EvolutionEvaluationError.make({
            evaluatorRef: "organization/evaluator/agent-benchmarks",
            operation: operation.operation,
            cause,
          })
      ),
    ),
});

export const unavailableEvolutionBenchmarkRunner = (
  reason: string,
): EvolutionBenchmarkRunnerShape => ({
  invoke: (operation) =>
    EvolutionEvaluationError.make({
      evaluatorRef: "organization/evaluator/agent-benchmarks",
      operation: operation.operation,
      cause: reason,
    }),
});
