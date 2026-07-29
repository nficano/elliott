import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { createOptimizationEngineClient as createDarwinianClient } from "../../../skills/evaluator/darwinian/src/index";
import { createOptimizationEngineClient as createDspyClient } from "../../../skills/evaluator/dspy/src/index";
import { hashBytes } from "../../../src/core/digest";
import { makeFallbackOptimizationEngine } from "../../../src/learning/evolution/engine/fallback";
import {
  EvolutionCodeSandboxContract,
  EvolutionDatasetIdSchema,
  EvolutionDatasetManifest,
  EvolutionOptimizerDatasetView,
  OptimizationEngineRequest,
} from "../../../src/learning/evolution/model/index";
import { makeRun } from "../../unit/evolution/helpers";
import { makeCandidate } from "../../unit/evolution/helpers";

const dataset = () =>
  EvolutionDatasetManifest.make({
    id: EvolutionDatasetIdSchema.make("evd_12345678"),
    targetDigest: "sha256:baseline",
    digest: "sha256:dataset",
    splitSeed: 1,
    splitDigests: {
      train: "sha256:train",
      validation: "sha256:validation",
      holdout: "sha256:holdout",
    },
    classification: "internal",
    sources: [],
    cases: [],
    createdAt: new Date(0).toISOString(),
    sealedAt: new Date(0).toISOString(),
    holdoutSealed: true,
  });

const request = () =>
  OptimizationEngineRequest.make({
    run: makeRun(),
    dataset: EvolutionOptimizerDatasetView.make({
      id: dataset().id,
      targetDigest: dataset().targetDigest,
      digest: dataset().digest,
      splitSeed: dataset().splitSeed,
      trainDigest: dataset().splitDigests.train,
      validationDigest: dataset().splitDigests.validation,
      classification: dataset().classification,
      sources: dataset().sources,
      trainCases: [],
      validationCases: [],
      holdoutSealed: true,
    }),
    baselineContent: "baseline",
    maximumCandidates: 10,
    maximumTokens: 1000,
    maximumCostUsd: 10,
    maximumDurationMilliseconds: 60_000,
    maximumConcurrency: 2,
    seed: 1,
  });

describe("evolution engine Components", () => {
  it("advertises GEPA/MIPROv2 and fails malformed IPC closed", async () => {
    const client = createDspyClient({
      endpoint: "https://companion.test",
      fetch: async () => Response.json({ malformed: true }),
    });
    const capabilities = await Effect.runPromise(
      client.describeCapabilities(),
    );
    expect(capabilities.engineKinds).toEqual(["gepa", "miprov2"]);
    await expect(Effect.runPromise(client.optimize(request())))
      .rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });

  it("refuses Darwinian without a sealed disposable sandbox contract", async () => {
    let invoked = false;
    const client = createDarwinianClient({
      endpoint: "https://companion.test",
      fetch: async () => {
        invoked = true;
        return Response.json({});
      },
    });
    await expect(Effect.runPromise(client.optimize(request())))
      .rejects.toHaveProperty("_tag", "EvolutionEngineError");
    expect(invoked).toBe(false);
  });

  it("invokes Darwinian with a valid candidate-only sandbox contract", async () => {
    const candidate = makeCandidate();
    let invoked = false;
    const client = createDarwinianClient({
      endpoint: "https://companion.test",
      fetch: async () => {
        invoked = true;
        return Response.json({
          runId: makeRun().id,
          candidates: [candidate],
          paused: false,
        });
      },
    });
    const result = await Effect.runPromise(client.optimize(
      OptimizationEngineRequest.make({
        ...request(),
        codeSandbox: EvolutionCodeSandboxContract.make({
          checkoutRef: "candidate://evc_12345678",
          checkoutFiles: [{
            path: "src/agent.ts",
            digest: hashBytes("export const agent = true;\n"),
            content: "export const agent = true;\n",
            executable: false,
          }],
          targetFiles: ["src/agent.ts"],
          testCommands: [["bun", "test", "test/unit/agent.test.ts"]],
          cpuQuota: 2,
          memoryMb: 2048,
          pids: 128,
          timeoutMilliseconds: 120_000,
          networkEnabled: false,
          repositoryCredentialsMounted: false,
          gitRemotePresent: false,
          activeTreeWritable: false,
          containerRuntimeSocketMounted: false,
        }),
      }),
    ));
    expect(result.candidates[0]?.id).toBe(candidate.id);
    expect(invoked).toBe(true);
  });

  it("decodes a valid GEPA candidate lineage response", async () => {
    const candidate = makeCandidate();
    const client = createDspyClient({
      endpoint: "https://companion.test",
      fetch: async () =>
        Response.json({
          runId: makeRun().id,
          candidates: [candidate],
          paused: false,
        }),
    });
    const result = await Effect.runPromise(client.optimize(request()));
    expect(result.candidates[0]?.id).toBe(candidate.id);
  });

  it("falls back from GEPA to MIPROv2 without losing resume routing", async () => {
    const candidate = makeCandidate();
    const primary = createDspyClient({
      endpoint: "https://gepa.test",
      fetch: async () => new Response("failed", { status: 500 }),
    });
    const fallback = createDspyClient({
      endpoint: "https://mipro.test",
      fetch: async () =>
        Response.json({
          runId: makeRun().id,
          candidates: [candidate],
          paused: true,
          resumeToken: "mipro-resume",
        }),
    });
    const result = await Effect.runPromise(
      makeFallbackOptimizationEngine(primary, fallback).optimize(request()),
    );
    expect(result.candidates[0]?.id).toBe(candidate.id);
    expect(result.resumeToken).toBe("fallback:mipro-resume");
  });

  it("fails oversized engine candidate fields at the schema boundary", async () => {
    const candidate = makeCandidate();
    const client = createDspyClient({
      endpoint: "https://companion.test",
      fetch: async () =>
        Response.json({
          runId: makeRun().id,
          candidates: [{
            ...candidate,
            patch: "x".repeat(2_000_001),
          }],
          paused: false,
        }),
    });
    await expect(Effect.runPromise(client.optimize(request())))
      .rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });

  it("fails negative engine resource usage at the schema boundary", async () => {
    const candidate = makeCandidate();
    const client = createDspyClient({
      endpoint: "https://companion.test",
      fetch: async () =>
        Response.json({
          runId: makeRun().id,
          candidates: [{
            ...candidate,
            usage: { ...candidate.usage, inputTokens: -1 },
          }],
          paused: false,
        }),
    });
    await expect(Effect.runPromise(client.optimize(request())))
      .rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });
});
