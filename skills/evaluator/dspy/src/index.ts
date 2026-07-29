import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionEngineError } from "../../../../src/learning/evolution/errors";
import {
  OptimizationEngineCapabilities,
  OptimizationEngineResult,
} from "../../../../src/learning/evolution/model/index";
import type { OptimizationEngineShape } from "../../../../src/learning/evolution/types";
import type { SkillRegistration } from "../../../../src/runtime/skills/types";
import type { DspyClientConfig } from "./types";

const request = (
  config: DspyClientConfig,
  operation: string,
  payload: unknown,
): Effect.Effect<unknown, EvolutionEngineError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await config.fetch(
        new URL(`/v1/${operation}`, config.endpoint),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(`DSPy companion returned HTTP ${response.status}`);
      }
      return response.json();
    },
    catch: (cause) =>
      EvolutionEngineError.make({
        engineRef: "organization/evaluator/dspy",
        operation,
        cause,
      }),
  });

const decodeResult = (
  operation: string,
  value: unknown,
): Effect.Effect<OptimizationEngineResult, EvolutionEngineError> =>
  Schema.decodeUnknownEffect(OptimizationEngineResult)(value).pipe(
    Effect.mapError((cause) =>
      EvolutionEngineError.make({
        engineRef: "organization/evaluator/dspy",
        operation,
        cause,
      })
    ),
  );

export const createOptimizationEngineClient = (
  config: DspyClientConfig,
): OptimizationEngineShape => ({
  describeCapabilities: () =>
    Effect.succeed(OptimizationEngineCapabilities.make({
      engineRef: "organization/evaluator/dspy",
      engineKinds: ["gepa", "miprov2"],
      targetClasses: ["skill", "tool-description", "prompt-segment"],
      pauseResume: true,
      isolation: "container",
      maximumCandidates: 40,
    })),
  optimize: (input) =>
    request(config, "optimize", input).pipe(
      Effect.flatMap((value) => decodeResult("optimize", value)),
    ),
  pause: (runId) =>
    request(config, "pause", { runId }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
      Effect.mapError((cause) =>
        EvolutionEngineError.make({
          engineRef: "organization/evaluator/dspy",
          operation: "pause",
          cause,
        })
      ),
    ),
  resume: (resumeToken) =>
    request(config, "resume", { resumeToken }).pipe(
      Effect.flatMap((value) => decodeResult("resume", value)),
    ),
  cancel: (runId) => request(config, "cancel", { runId }).pipe(Effect.asVoid),
});

export const register = (): SkillRegistration => ({});

export { EvolutionRunIdSchema as DspyWireRunId } from "../../../../src/learning/evolution/model/index";
