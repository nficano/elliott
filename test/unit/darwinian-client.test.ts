import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { createOptimizationEngineClient } from "../../skills/evaluator-darwinian/src/index";
import {
  EvolutionDatasetIdSchema,
  EvolutionOptimizerDatasetView,
  OptimizationEngineRequest,
  OptimizationEngineResult,
} from "../../src/learning/evolution/model/index";
import { makeCandidate, makeRun, RUN_ID } from "./evolution/helpers";

const request = () =>
  OptimizationEngineRequest.make({
    run: { ...makeRun(), target: { ...makeRun().target, targetClass: "code" } },
    dataset: EvolutionOptimizerDatasetView.make({
      id: EvolutionDatasetIdSchema.make("evd_12345678"),
      targetDigest: "sha256:baseline",
      digest: "sha256:dataset",
      splitSeed: 1,
      trainDigest: "sha256:train",
      validationDigest: "sha256:validation",
      classification: "internal",
      sources: [],
      trainCases: [],
      validationCases: [],
      holdoutSealed: true,
    }),
    baselineContent: "baseline",
    maximumCandidates: 2,
    maximumTokens: 100,
    maximumCostUsd: 1,
    maximumDurationMilliseconds: 1000,
    maximumConcurrency: 1,
    seed: 1,
  });

describe("darwinian optimization client", () => {
  it("pauses, resumes, cancels, and refuses optimize without sandbox", async () => {
    const result = OptimizationEngineResult.make({
      runId: RUN_ID,
      candidates: [makeCandidate()],
      paused: false,
    });
    const client = createOptimizationEngineClient({
      endpoint: "https://darwin.test",
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith("/v1/pause")) return Response.json("paused-token");
        if (url.endsWith("/v1/resume")) return Response.json(result);
        if (url.endsWith("/v1/cancel")) return Response.json({ ok: true });
        return new Response("missing", { status: 404 });
      },
    });
    expect(
      (await Effect.runPromise(client.describeCapabilities())).engineKinds,
    ).toEqual(["darwinian"]);
    await expect(Effect.runPromise(client.optimize(request()))).rejects
      .toHaveProperty("_tag", "EvolutionEngineError");
    expect(await Effect.runPromise(client.pause(RUN_ID))).toBe("paused-token");
    expect((await Effect.runPromise(client.resume("token"))).paused).toBe(
      false,
    );
    await Effect.runPromise(client.cancel(RUN_ID));
    await expect(
      Effect.runPromise(
        createOptimizationEngineClient({
          endpoint: "https://darwin.test",
          fetch: async () => new Response("nope", { status: 500 }),
        }).pause(RUN_ID),
      ),
    ).rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });
});
