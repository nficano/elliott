import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { EvolutionIndependentEvaluatorShape } from "../application/types";
import { EvolutionEvaluationError } from "../errors";
import {
  EvolutionBaselineReport,
  EvolutionEvaluationReport,
} from "../model/index";
import {
  assertEvolutionBaselineReportBindings,
  assertEvolutionEvaluationReportBindings,
} from "./bindings";
import type { HttpIndependentEvaluatorConfig } from "./types";

const post = (
  config: HttpIndependentEvaluatorConfig,
  input: {
    readonly path: string;
    readonly operation: string;
    readonly body: unknown;
  },
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await (config.fetch ?? globalThis.fetch)(
        new URL(input.path, config.endpoint),
        {
          method: "POST",
          headers: {
            ...(config.token !== undefined && {
              authorization: `Bearer ${config.token}`,
            }),
            "content-type": "application/json",
          },
          body: JSON.stringify(input.body),
        },
      );
      if (!response.ok) {
        throw new Error(
          `independent evaluator returned HTTP ${response.status}`,
        );
      }
      return response.json();
    },
    catch: (cause) =>
      EvolutionEvaluationError.make({
        evaluatorRef: "organization/evaluator/independent",
        operation: input.operation,
        cause,
      }),
  });

const decodeError = (operation: string) => (cause: unknown) =>
  cause instanceof EvolutionEvaluationError
    ? cause
    : EvolutionEvaluationError.make({
      evaluatorRef: "organization/evaluator/independent",
      operation,
      cause,
    });

export const makeHttpIndependentEvaluator = (
  config: HttpIndependentEvaluatorConfig,
): EvolutionIndependentEvaluatorShape => ({
  baseline: (request) =>
    post(config, {
      path: "/v1/baseline",
      operation: "baseline",
      body: request,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(EvolutionBaselineReport)),
      Effect.tap((report) =>
        assertEvolutionBaselineReportBindings(request, report)
      ),
      Effect.mapError(decodeError("decode-baseline-report")),
    ),
  compare: (request) =>
    post(config, {
      path: "/v1/compare",
      operation: "compare",
      body: request,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(EvolutionEvaluationReport)),
      Effect.tap((report) =>
        assertEvolutionEvaluationReportBindings(request, report)
      ),
      Effect.mapError(decodeError("decode-report")),
    ),
});

export const unavailableIndependentEvaluator = (
  reason: string,
): EvolutionIndependentEvaluatorShape => ({
  baseline: () =>
    EvolutionEvaluationError.make({
      evaluatorRef: "organization/evaluator/independent",
      operation: "baseline",
      cause: reason,
    }),
  compare: () =>
    EvolutionEvaluationError.make({
      evaluatorRef: "organization/evaluator/independent",
      operation: "compare",
      cause: reason,
    }),
});
