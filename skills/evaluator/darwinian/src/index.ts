import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { validateCodeSandboxContract } from "../../../../src/learning/evolution/engine/isolation";
import { EvolutionEngineError } from "../../../../src/learning/evolution/errors";
import {
  OptimizationEngineCapabilities,
  OptimizationEngineResult,
} from "../../../../src/learning/evolution/model/index";
import type { OptimizationEngineShape } from "../../../../src/learning/evolution/types";
import type { SkillRegistration } from "../../../../src/runtime/skills/types";
import type { DarwinianClientConfig } from "./types";

const invoke = (
  config: DarwinianClientConfig,
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
        throw new Error(`Darwinian companion returned HTTP ${response.status}`);
      }
      return response.json();
    },
    catch: (cause) =>
      EvolutionEngineError.make({
        engineRef: "organization/evaluator/darwinian",
        operation,
        cause,
      }),
  });

const decodeResult = (operation: string, value: unknown) =>
  Schema.decodeUnknownEffect(OptimizationEngineResult)(value).pipe(
    Effect.mapError((cause) =>
      EvolutionEngineError.make({
        engineRef: "organization/evaluator/darwinian",
        operation,
        cause,
      })
    ),
  );

export const createOptimizationEngineClient = (
  config: DarwinianClientConfig,
): OptimizationEngineShape => ({
  describeCapabilities: () =>
    Effect.succeed(OptimizationEngineCapabilities.make({
      engineRef: "organization/evaluator/darwinian",
      engineKinds: ["darwinian"],
      targetClasses: ["code"],
      pauseResume: true,
      isolation: "container",
      maximumCandidates: 20,
    })),
  optimize: (input) => {
    if (input.codeSandbox === undefined) {
      return EvolutionEngineError.make({
        engineRef: "organization/evaluator/darwinian",
        operation: "optimize",
        cause: "a sealed disposable code sandbox contract is required",
      });
    }
    return validateCodeSandboxContract(input.codeSandbox).pipe(
      Effect.flatMap(() => invoke(config, "optimize", input)),
      Effect.flatMap((value) => decodeResult("optimize", value)),
    );
  },
  pause: (runId) =>
    invoke(config, "pause", { runId }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
      Effect.mapError((cause) =>
        EvolutionEngineError.make({
          engineRef: "organization/evaluator/darwinian",
          operation: "pause",
          cause,
        })
      ),
    ),
  resume: (resumeToken) =>
    invoke(config, "resume", { resumeToken }).pipe(
      Effect.flatMap((value) => decodeResult("resume", value)),
    ),
  cancel: (runId) => invoke(config, "cancel", { runId }).pipe(Effect.asVoid),
});

export const register = (): SkillRegistration => ({});
