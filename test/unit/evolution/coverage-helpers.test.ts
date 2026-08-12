import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest, snapshotId } from "../../../src/core/brands";
import { MemoryRecordAppender } from "../../../src/core/waist/records";
import {
  detectEvolutionSignal,
  EvolutionDatasetIdSchema,
  EvolutionEngineError,
  EvolutionOptimizerDatasetView,
  evolutionSignalFromBenchmark,
  evolutionSignalFromFeedback,
  evolutionSignalFromToolFailure,
  InMemoryEvolutionProjectionStore,
  makeEvolutionAgentOperations,
  makeFallbackOptimizationEngine,
  OptimizationEngineRequest,
  OptimizationEngineResult,
  projectEvolutionPerformance,
  trajectoryFromEvidence,
  validatePromptAssemblyCandidate,
} from "../../../src/learning/evolution/index";
import {
  containedPath,
  writeTextAtomic,
} from "../../../src/learning/evolution/store/files";
import type { OptimizationEngineShape } from "../../../src/learning/evolution/types";
import type { PromptAssembly, PromptSegment } from "../../../src/prompt/types";
import { CANDIDATE_ID, makeCandidate, makeRun, RUN_ID } from "./helpers";

const segment = (
  id: string,
  content: string,
): PromptSegment => ({
  id,
  purpose: "interaction-profile",
  source: id,
  digest: digest(`sha256:${content}`),
  trust: "authenticated",
  securityTags: [],
  classification: "internal",
  content,
});

const assembly = (
  snap: string,
  segments: readonly PromptSegment[],
): PromptAssembly => ({
  snapshot: snapshotId(snap),
  segments,
  stablePrefix: segments.slice(0, 1),
  volatileSuffix: segments.slice(1),
  cacheBreakpoint: 1,
  effectiveClassification: "internal",
});

const datasetView = () =>
  EvolutionOptimizerDatasetView.make({
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
  });

const requestFor = (run = makeRun()) =>
  OptimizationEngineRequest.make({
    run,
    dataset: datasetView(),
    baselineContent: "baseline",
    maximumCandidates: 10,
    maximumTokens: 1000,
    maximumCostUsd: 10,
    maximumDurationMilliseconds: 60_000,
    maximumConcurrency: 2,
    seed: 1,
  });

const engine = (
  tag: string,
  failOptimize = false,
  failPause = false,
  failCancel = false,
): OptimizationEngineShape => ({
  describeCapabilities: () => Effect.die("unused"),
  optimize: () =>
    failOptimize
      ? EvolutionEngineError.make({
        engineRef: tag,
        operation: "optimize",
        cause: "boom",
      })
      : Effect.succeed(OptimizationEngineResult.make({
        runId: RUN_ID,
        candidates: [makeCandidate()],
        paused: true,
        resumeToken: `${tag}-token`,
      })),
  pause: () =>
    failPause
      ? EvolutionEngineError.make({
        engineRef: tag,
        operation: "pause",
        cause: "boom",
      })
      : Effect.succeed(`${tag}-pause`),
  resume: () =>
    Effect.succeed(OptimizationEngineResult.make({
      runId: RUN_ID,
      candidates: [makeCandidate()],
      paused: false,
      resumeToken: `${tag}-resume`,
    })),
  cancel: () =>
    failCancel
      ? EvolutionEngineError.make({
        engineRef: tag,
        operation: "cancel",
        cause: "boom",
      })
      : Effect.void,
});

describe("evolution coverage helpers", () => {
  it("validates prompt-assembly candidates", () => {
    const baseline = assembly("snap:a", [
      segment("keep", "stable"),
      segment("target", "old"),
    ]);
    const good = assembly("snap:b", [
      segment("keep", "stable"),
      segment("target", "new"),
    ]);
    expect(
      validatePromptAssemblyCandidate({
        baseline,
        candidate: good,
        targetSegmentId: "target",
      }).passed,
    ).toBe(true);
    expect(
      validatePromptAssemblyCandidate({
        baseline,
        candidate: assembly("snap:a", [
          segment("keep", "changed"),
          segment("target", "new"),
        ]),
        targetSegmentId: "target",
      }).passed,
    ).toBe(false);
  });

  it("builds trajectories and performance projections", () => {
    const trajectory = trajectoryFromEvidence({
      runId: RUN_ID,
      candidateId: CANDIDATE_ID,
      snapshotId: "snapshot:baseline",
      routeDigest: "sha256:route",
      componentUses: [],
      toolCalls: [{
        id: "call-1",
        runId: RUN_ID,
        selectedTool: "files.read",
        schemaDigest: "sha256:schema",
        argumentsDigest: "sha256:args",
        resultDigest: "sha256:result",
        latencyMilliseconds: 12,
        errorTag: "timeout",
        createdAt: new Date(0).toISOString(),
      }],
      labels: [{
        id: "label-1",
        runId: RUN_ID,
        evaluatorRef: "eval",
        rubricDigest: "sha256:rubric",
        score: 0.9,
        confidence: 1,
        source: "fixture",
        createdAt: new Date(0).toISOString(),
      }],
      modelSelections: [],
      totalCostUsd: 0.02,
    });
    expect(trajectory.steps).toHaveLength(1);
    expect(trajectory.steps[0]?.toolRef).toBe("files.read");

    const projection = projectEvolutionPerformance(
      { target: makeRun().target },
      {
        candidateCases: [{ passed: true }, { passed: false }],
        benchmarks: [{ status: "passed", candidateScore: 0.8 }],
        metrics: [{ candidate: 0.5 }],
        totalCostUsd: 0.2,
        createdAt: new Date(0).toISOString(),
      },
      0.25,
    );
    const store = new InMemoryEvolutionProjectionStore();
    store.put(projection);
    expect(store.get(projection.targetRef)).toEqual(projection);
    expect(store.list()).toEqual([projection]);
  });

  it("detects feedback, tool-failure, and benchmark signals", async () => {
    const feedback = evolutionSignalFromFeedback({
      feedback: {
        id: "fb-1",
        runId: RUN_ID,
        targetRef: "workspace/skill/review",
        kind: "explicit-correction",
        evidenceDigest: "sha256:evidence",
        createdAt: new Date(0).toISOString(),
      },
      targetClass: "skill",
      riskClass: "C1",
      usageFrequency: 1,
      expectedImpact: 0.5,
      estimatedCost: 1,
      classification: "internal",
    });
    expect(feedback.strength).toBe(1);
    expect(
      evolutionSignalFromFeedback({
        feedback: {
          id: "fb-2",
          runId: RUN_ID,
          targetRef: "workspace/skill/review",
          kind: "confirmed-success",
          evidenceDigest: "sha256:evidence",
          createdAt: new Date(0).toISOString(),
        },
        targetClass: "skill",
        riskClass: "C1",
        usageFrequency: 1,
        expectedImpact: 0.5,
        estimatedCost: 1,
        classification: "internal",
      }).strength,
    ).toBeLessThan(1);

    expect(
      evolutionSignalFromToolFailure({
        toolCall: {
          id: "tc-1",
          runId: RUN_ID,
          schemaDigest: "sha256:schema",
          resultDigest: "sha256:result",
          latencyMilliseconds: 1,
          errorTag: "timeout",
          createdAt: new Date(0).toISOString(),
        },
        targetRef: "core/tool/description-catalog",
        riskClass: "C2",
        usageFrequency: 2,
        expectedImpact: 0.4,
        estimatedCost: 2,
        classification: "internal",
      }).strength,
    ).toBe(1);
    expect(
      evolutionSignalFromToolFailure({
        toolCall: {
          id: "tc-2",
          runId: RUN_ID,
          schemaDigest: "sha256:schema",
          latencyMilliseconds: 1,
          createdAt: new Date(0).toISOString(),
        },
        targetRef: "core/tool/description-catalog",
        riskClass: "C2",
        usageFrequency: 2,
        expectedImpact: 0.4,
        estimatedCost: 2,
        classification: "internal",
      }).strength,
    ).toBeLessThan(1);

    expect(
      evolutionSignalFromBenchmark({
        id: "bm-1",
        targetRef: "workspace/skill/review",
        targetClass: "skill",
        riskClass: "C1",
        scoreDelta: -0.3,
        evaluatorConfidence: 0.9,
        evidenceDigest: "sha256:bench",
        estimatedCost: 3,
        classification: "internal",
        createdAt: new Date(0).toISOString(),
      }).strength,
    ).toBeCloseTo(0.3);

    const records = new MemoryRecordAppender();
    const detected = await Effect.runPromise(
      detectEvolutionSignal(feedback, records),
    );
    expect(detected.id).toBe("fb-1");
  });

  it("executes agent operation tools and fallback engine routes", async () => {
    const seen: string[] = [];
    const operations = makeEvolutionAgentOperations({
      inspectTarget: async (ref) => {
        seen.push(`inspect:${ref}`);
        return { ref };
      },
      requestRun: async (ref) => {
        seen.push(`run:${ref}`);
        return { ref };
      },
      getStatus: async (id) => {
        seen.push(`status:${id}`);
        return { id };
      },
      requestProposal: async (runId, candidateId) => {
        seen.push(`propose:${runId}:${candidateId}`);
        return { runId, candidateId };
      },
    });
    expect(JSON.parse(
      await operations.tools[0]!.execute({ target_ref: "t" }),
    )).toEqual({ ref: "t" });
    expect(JSON.parse(
      await operations.tools[1]!.execute({ target_ref: "t" }),
    )).toEqual({ ref: "t" });
    expect(JSON.parse(
      await operations.tools[2]!.execute({ run_id: "r" }),
    )).toEqual({ id: "r" });
    expect(JSON.parse(
      await operations.tools[3]!.execute({
        run_id: "r",
        candidate_id: "c",
      }),
    )).toEqual({ runId: "r", candidateId: "c" });
    expect(seen).toEqual([
      "inspect:t",
      "run:t",
      "status:r",
      "propose:r:c",
    ]);

    const primaryFails = makeFallbackOptimizationEngine(
      engine("primary", true, true, true),
      engine("fallback"),
    );
    const mipro = makeFallbackOptimizationEngine(
      engine("primary"),
      engine("fallback"),
    );
    const miproResult = await Effect.runPromise(
      mipro.optimize(requestFor({
        ...makeRun(),
        engineKind: "miprov2",
      })),
    );
    expect(miproResult.resumeToken).toBe("fallback:fallback-token");

    const recovered = await Effect.runPromise(
      primaryFails.optimize(requestFor()),
    );
    expect(recovered.resumeToken).toBe("fallback:fallback-token");
    expect(await Effect.runPromise(primaryFails.pause(RUN_ID))).toBe(
      "fallback:fallback-pause",
    );
    const resumed = await Effect.runPromise(
      primaryFails.resume("fallback:token"),
    );
    expect(resumed.resumeToken).toBe("fallback:fallback-resume");
    const primaryResume = await Effect.runPromise(
      primaryFails.resume("token-without-route"),
    );
    expect(primaryResume.resumeToken).toBe("primary:primary-resume");
    await Effect.runPromise(primaryFails.cancel(RUN_ID));
  });

  it("rejects escaping store paths and cleans failed atomic writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-store-"));
    try {
      await expect(Effect.runPromise(containedPath(root, ".."))).rejects
        .toHaveProperty("_tag", "EvolutionContainmentError");
      const inside = await Effect.runPromise(containedPath(root, "ok.txt"));
      await writeFile(inside, "locked", { flag: "wx" });
      await expect(
        Effect.runPromise(writeTextAtomic(path.join(inside, "child.txt"), "x")),
      ).rejects.toHaveProperty("_tag", "EvolutionPersistenceError");

      const destination = path.join(root, "dir-as-file");
      await mkdir(destination, { recursive: true });
      await expect(
        Effect.runPromise(writeTextAtomic(destination, "content")),
      ).rejects.toHaveProperty("_tag", "EvolutionPersistenceError");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
