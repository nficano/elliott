import * as Effect from "effect/Effect";
import { OptimizationEngineResult } from "../model/index";
import type { OptimizationEngineShape } from "../types";

const withResumeRoute = (
  route: "primary" | "fallback",
  result: OptimizationEngineResult,
): OptimizationEngineResult =>
  result.resumeToken === undefined
    ? result
    : OptimizationEngineResult.make({
      ...result,
      resumeToken: `${route}:${result.resumeToken}`,
    });

export const makeFallbackOptimizationEngine = (
  primary: OptimizationEngineShape,
  fallback: OptimizationEngineShape,
): OptimizationEngineShape => ({
  describeCapabilities: primary.describeCapabilities,
  optimize: (request) => {
    if (request.run.engineKind === "miprov2") {
      return fallback.optimize(request).pipe(
        Effect.map((result) => withResumeRoute("fallback", result)),
      );
    }
    return primary.optimize(request).pipe(
      Effect.map((result) => withResumeRoute("primary", result)),
      Effect.catchTag(
        "EvolutionEngineError",
        () =>
          fallback.optimize(request).pipe(
            Effect.map((result) => withResumeRoute("fallback", result)),
          ),
      ),
    );
  },
  pause: (runId) =>
    primary.pause(runId).pipe(
      Effect.map((token) => `primary:${token}`),
      Effect.catchTag("EvolutionEngineError", () =>
        fallback.pause(runId).pipe(
          Effect.map((token) => `fallback:${token}`),
        )),
    ),
  resume: (resumeToken) => {
    const separator = resumeToken.indexOf(":");
    const route = resumeToken.slice(0, separator);
    const token = separator === -1
      ? resumeToken
      : resumeToken.slice(separator + 1);
    return (route === "fallback" ? fallback : primary).resume(token).pipe(
      Effect.map((result) =>
        withResumeRoute(route === "fallback" ? "fallback" : "primary", result)
      ),
    );
  },
  cancel: (runId) =>
    primary.cancel(runId).pipe(
      Effect.catchTag("EvolutionEngineError", () => fallback.cancel(runId)),
    ),
});
