import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  makeHttpOptimizationEngine,
  unavailableOptimizationEngine,
} from "../../../src/learning/evolution/engine/http";
import {
  EvolutionCandidate,
  EvolutionCandidateUsage,
  EvolutionConstraintResult,
  EvolutionRunIdSchema,
  OptimizationEngineCapabilities,
  OptimizationEngineResult,
} from "../../../src/learning/evolution/model/index";
import { CANDIDATE_ID, RUN_ID } from "./helpers";

const asFetch = (
  impl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch => impl as unknown as typeof fetch;

const capabilities = OptimizationEngineCapabilities.make({
  engineRef: "org/engine",
  engineKinds: ["gepa"],
  targetClasses: ["skill"],
  pauseResume: true,
  isolation: "container",
  maximumCandidates: 2,
});

const candidate = () =>
  EvolutionCandidate.make({
    id: CANDIDATE_ID,
    runId: RUN_ID,
    targetDigest: "sha256:baseline",
    candidateDigest: "sha256:candidate",
    patch: "-a\n+b",
    materializedContent: "b",
    engineTraceDigest: "sha256:trace",
    usage: EvolutionCandidateUsage.make({
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMilliseconds: 1,
    }),
    constraints: [
      EvolutionConstraintResult.make({
        constraint: "syntax",
        passed: true,
        detail: "ok",
        evidenceDigests: [],
      }),
    ],
    createdAt: new Date(0).toISOString(),
  });

const optimizeResult = () =>
  OptimizationEngineResult.make({
    runId: RUN_ID,
    candidates: [candidate()],
    paused: false,
  });

describe("HTTP optimization engine", () => {
  it("posts optimize/resume/pause/cancel and surfaces HTTP failures", async () => {
    const calls: string[] = [];
    const fetchImpl = asFetch(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/optimize")) {
        return Response.json(optimizeResult(), { status: 200 });
      }
      if (url.endsWith("/v1/resume")) {
        return Response.json(
          OptimizationEngineResult.make({
            runId: RUN_ID,
            candidates: [],
            paused: false,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/v1/pause")) {
        return Response.json("resume-token", { status: 200 });
      }
      if (url.endsWith("/v1/cancel")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });

    const engine = makeHttpOptimizationEngine({
      endpoint: "https://optimizer.test",
      engineRef: "org/engine",
      capabilities,
      fetch: fetchImpl,
    });

    expect(await Effect.runPromise(engine.describeCapabilities())).toEqual(
      capabilities,
    );
    const optimized = await Effect.runPromise(engine.optimize({} as never));
    expect(optimized.candidates).toHaveLength(1);
    expect(
      await Effect.runPromise(
        engine.pause(EvolutionRunIdSchema.make("evr_12345678")),
      ),
    ).toBe("resume-token");
    await Effect.runPromise(engine.resume("resume-token"));
    await Effect.runPromise(
      engine.cancel(EvolutionRunIdSchema.make("evr_12345678")),
    );
    expect(calls.some((url) => url.includes("/v1/optimize"))).toBe(true);
    expect(calls.some((url) => url.includes("/v1/cancel"))).toBe(true);

    const failing = makeHttpOptimizationEngine({
      endpoint: "https://optimizer.test",
      engineRef: "org/engine",
      capabilities,
      fetch: asFetch(async () => new Response("nope", { status: 503 })),
    });
    const failed = await Effect.runPromiseExit(failing.optimize({} as never));
    expect(failed._tag).toBe("Failure");
  });

  it("maps invalid pause payloads to EvolutionEngineError", async () => {
    const engine = makeHttpOptimizationEngine({
      endpoint: "https://optimizer.test",
      engineRef: "org/engine",
      capabilities,
      fetch: asFetch(async () =>
        Response.json({ not: "a string" }, { status: 200 })
      ),
    });
    await expect(
      Effect.runPromise(
        engine.pause(EvolutionRunIdSchema.make("evr_12345678")),
      ),
    ).rejects.toThrow();
  });
});

describe("unavailableOptimizationEngine", () => {
  it("fails every operation with EvolutionEngineError", async () => {
    const engine = unavailableOptimizationEngine("org/engine", "missing url");
    const fail = async (effect: Effect.Effect<unknown, unknown>) => {
      const exit = await Effect.runPromiseExit(effect);
      expect(exit._tag).toBe("Failure");
    };
    await fail(engine.describeCapabilities());
    await fail(engine.optimize({} as never));
    await fail(engine.pause(EvolutionRunIdSchema.make("evr_12345678")));
    await fail(engine.resume("tok"));
    await fail(engine.cancel(EvolutionRunIdSchema.make("evr_12345678")));
  });
});
