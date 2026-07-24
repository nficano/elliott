import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EvolutionEngineError } from "../errors";
import { OptimizationEngineResult } from "../model/index";
import type { OptimizationEngineShape } from "../types";
import type { HttpOptimizationEngineConfig } from "./types";

const invoke = (
  config: HttpOptimizationEngineConfig,
  operation: string,
  payload: unknown,
) =>
  Effect.tryPromise({
    try: async () => {
      const response = await (config.fetch ?? globalThis.fetch)(
        new URL(`/v1/${operation}`, config.endpoint),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(`optimizer returned HTTP ${response.status}`);
      }
      return response.json();
    },
    catch: (cause) =>
      EvolutionEngineError.make({
        engineRef: config.engineRef,
        operation,
        cause,
      }),
  });

const decodeResult = (
  config: HttpOptimizationEngineConfig,
  operation: string,
  value: unknown,
) =>
  Schema.decodeUnknownEffect(OptimizationEngineResult)(value).pipe(
    Effect.mapError((cause) =>
      EvolutionEngineError.make({
        engineRef: config.engineRef,
        operation,
        cause,
      })
    ),
  );

export const makeHttpOptimizationEngine = (
  config: HttpOptimizationEngineConfig,
): OptimizationEngineShape => ({
  describeCapabilities: () => Effect.succeed(config.capabilities),
  optimize: (request) =>
    invoke(config, "optimize", request).pipe(
      Effect.flatMap((value) => decodeResult(config, "optimize", value)),
    ),
  pause: (runId) =>
    invoke(config, "pause", { runId }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.String)),
      Effect.mapError((cause) =>
        cause instanceof EvolutionEngineError
          ? cause
          : EvolutionEngineError.make({
            engineRef: config.engineRef,
            operation: "pause",
            cause,
          })
      ),
    ),
  resume: (resumeToken) =>
    invoke(config, "resume", { resumeToken }).pipe(
      Effect.flatMap((value) => decodeResult(config, "resume", value)),
    ),
  cancel: (runId) => invoke(config, "cancel", { runId }).pipe(Effect.asVoid),
});

export const unavailableOptimizationEngine = (
  engineRef: string,
  reason: string,
): OptimizationEngineShape => {
  const failure = (operation: string) =>
    EvolutionEngineError.make({ engineRef, operation, cause: reason });
  return {
    describeCapabilities: () => failure("describeCapabilities"),
    optimize: () => failure("optimize"),
    pause: () => failure("pause"),
    resume: () => failure("resume"),
    cancel: () => failure("cancel"),
  };
};
