import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { componentRef, principalId } from "../../../src/core/brands";
import { hashBytes } from "../../../src/core/digest";
import { MemoryRecordAppender } from "../../../src/core/waist/records";
import { AgentKernel } from "../../../src/kernel";
import type {
  EvolutionTargetCatalogShape,
} from "../../../src/learning/evolution/application/types";
import type {
  EvolutionControlPlaneExecutor,
} from "../../../src/learning/evolution/cli/types";
import { EvolutionConfig } from "../../../src/learning/evolution/config";
import {
  FileEvolutionProjectionStore,
  makeEvolutionContinuousController,
  makeEvolutionContinuousWorkflow,
  makeEvolutionScheduledBenchmark,
  makeEvolutionScheduledCampaign,
  makeScheduledEvolutionOperator,
  projectEvolutionPerformance,
  runRecurringEvolutionBenchmark,
} from "../../../src/learning/evolution/continuous/index";
import {
  EvolutionBenchmarkResult,
  EvolutionBudgets,
  EvolutionPerformanceProjection,
  EvolutionSignal,
  EvolutionTarget,
} from "../../../src/learning/evolution/model/index";
import { SessionStore } from "../../../src/memory/session-store/index";
import { makeRuntimeContinuousEvolutionService } from "../../../src/runtime/evolution-scheduler";
import { selectRuntimeEvolutionSignal } from "../../../src/runtime/evolution-signals";
import type { RuntimeEvolutionSettings } from "../../../src/runtime/types";
import { Scheduler } from "../../../src/scheduler/index";
import { KernelContextManager } from "../../../src/security/ifc/context-manager";

const roots: string[] = [];
const SCHEDULER_CAPABILITIES = [
  "evolution.target.read",
  "evolution.dataset.read",
  "evolution.engine.invoke",
  "evolution.candidate.write",
  "evaluation.run",
  "proposal.author",
] as const;

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const weakSignal = () =>
  EvolutionSignal.make({
    id: "signal",
    targetRef: "workspace/skill/review",
    targetClass: "skill",
    riskClass: "C1",
    strength: 1,
    usageFrequency: 2,
    expectedImpact: 3,
    evaluatorConfidence: 1,
    estimatedCost: 1,
    source: "benchmark",
    createdAt: new Date(0).toISOString(),
  });

const continuousConfig = () =>
  EvolutionConfig.make({
    apiVersion: "elliott/v1",
    engines: {
      text: { primary: "organization/evaluator/dspy-gepa" },
      code: { primary: "organization/evaluator/darwinian" },
    },
    budgets: {
      perRun: {
        candidates: 1,
        tokens: 1,
        costUsd: 1,
        durationMinutes: 1,
      },
      monthly: { costUsd: 1 },
    },
    evaluation: {
      authoringProfile: "deep",
      judgingProfile: "deep",
      requireDistinctRoute: true,
      split: { train: 0.6, validation: 0.2, holdout: 0.2 },
    },
    continuous: {
      enabled: true,
      benchmarkCron: "0 3 * * 0",
      optimizationCron: "0 4 * * 0",
      maximumRiskClass: "C2",
      maximumConcurrentRuns: 1,
    },
    targets: { allow: ["workspace/skill/*"], deny: [] },
  });

const runtimeSettings = (
  overrides: Partial<RuntimeEvolutionSettings> = {},
): RuntimeEvolutionSettings => ({
  controlToken: "control",
  operatorPrincipalId: "operator/evolution",
  operatorCapabilities: [],
  agentCapabilities: [],
  schedulerPrincipalId: "scheduler/evolution",
  schedulerCapabilities: SCHEDULER_CAPABILITIES,
  ...overrides,
});

describe("continuous evolution integration", () => {
  it("runs an unattended cycle only through a review-ready Proposal", async () => {
    const stages: string[] = [];
    const workflow = makeEvolutionContinuousWorkflow({
      detect: (signal) =>
        Effect.sync(() => {
          stages.push("detect");
          return { signal, runId: "evr_cycle" };
        }),
      buildDataset: (input) =>
        Effect.sync(() => {
          stages.push("dataset");
          return { ...input, datasetId: "evd_cycle" };
        }),
      optimize: (input) =>
        Effect.sync(() => {
          stages.push("optimize");
          return { ...input, candidateId: "evc_cycle", costUsd: 1 };
        }),
      evaluate: (input) =>
        Effect.sync(() => {
          stages.push("evaluate");
          return { ...input, reportId: "eve_cycle" };
        }),
      authorProposal: (input) =>
        Effect.sync(() => {
          stages.push("proposal");
          return { ...input, proposalId: "prp_cycle" };
        }),
    }, { notify: async () => undefined });
    const controller = makeEvolutionContinuousController(workflow);
    const outcome = await Effect.runPromise(controller.cycle({
      signals: [weakSignal()],
      cooldownTargetRefs: new Set(),
      activeTargetRefs: new Set(),
      activeRunCount: 0,
      maximumConcurrentRuns: 1,
      monthlySpentUsd: 0,
      monthlyBudgetUsd: 10,
      maximumRiskClass: "C2",
    }));
    expect(stages).toEqual([
      "detect",
      "dataset",
      "optimize",
      "evaluate",
      "proposal",
    ]);
    expect(outcome.result?.proposalId).toBe("prp_cycle");
    expect(workflow.mayApprove).toBe(false);
    expect(workflow.mayPromote).toBe(false);
  });

  it("SE14 reloads recurring jobs with fresh authority and bounded backoff", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-continuous-"));
    roots.push(root);
    const projections = new FileEvolutionProjectionStore(
      path.join(root, "projections"),
    );
    projections.put(EvolutionPerformanceProjection.make({
      targetRef: "workspace/skill/review",
      targetClass: "skill",
      targetDigest: "sha256:target",
      successRate: 0.5,
      correctionRate: 0.2,
      benchmarkScore: 0.4,
      averageCostUsd: 1,
      sampleCount: 10,
      projectedAt: new Date(0).toISOString(),
    }));
    expect(
      new FileEvolutionProjectionStore(path.join(root, "projections"))
        .list(),
    ).toHaveLength(1);

    const database = path.join(root, "sessions.sqlite");
    const firstStore = new SessionStore(database);
    const campaign = makeEvolutionScheduledBenchmark({
      jobId: "benchmark",
      principalId: principalId("scheduler"),
      agentRef: componentRef("core/agent/evolution"),
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      runAt: new Date(0).toISOString(),
      cron: "* * * * *",
    });
    await firstStore.schedule(campaign.job);
    firstStore.close();

    const store = new SessionStore(database);
    let attempts = 0;
    const records = new MemoryRecordAppender();
    const scheduler = new Scheduler({
      store,
      authority: { resolve: async () => true },
      frames: {
        create: () =>
          new KernelContextManager(records, {
            sanitize: async () => ({ approved: false }),
          }).activeFrame,
      },
      executor: {
        execute: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("fixture failure");
        },
      },
      records,
    });
    expect((await scheduler.tick("worker", new Date(0)))[0]?.type)
      .toBe("failed");
    expect(await scheduler.tick("worker", new Date(30_000))).toHaveLength(0);
    expect((await scheduler.tick("worker", new Date(60_000)))[0]?.type)
      .toBe("completed");
    expect(attempts).toBe(2);
    store.close();
  });

  it("runs the real scheduled operator only through a passing Proposal", async () => {
    const campaign = makeEvolutionScheduledCampaign({
      jobId: "campaign",
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      engineRef: "organization/evaluator/dspy-gepa",
      runAt: new Date(0).toISOString(),
    });
    const operations: string[] = [];
    const argumentsByOperation = new Map<string, readonly string[]>();
    const notifications: string[] = [];
    const executor = makeScheduledEvolutionOperator({
      currentSnapshotId: () => "snapshot:current",
      grantedCapabilities: campaign.job.requestedCapabilities.map((item) =>
        item.capability
      ),
      campaignDecision: async () => ({ signalId: "signal-weak-target" }),
      executor: {
        execute: async (_authority, request) => {
          operations.push(request.operation);
          argumentsByOperation.set(request.operation, request.arguments);
          switch (request.operation) {
            case "evolution.inspect": {
              return { baselineDigest: "sha256:target" };
            }
            case "evolution.run": {
              return {
                runId: "evr_scheduled",
                state: "optimizing",
                candidateIds: [],
              };
            }
            case "evolution.resume": {
              return {
                runId: "evr_scheduled",
                state: "shortlisted",
                candidateIds: ["evc_scheduled"],
              };
            }
            case "evolution.compare": {
              return { candidateId: "evc_scheduled", passed: true };
            }
            case "evolution.propose": {
              return { id: "prp_scheduled" };
            }
            default: {
              throw new Error(`forbidden operation ${request.operation}`);
            }
          }
        },
      },
      onProposalReady: async (proposalId) => {
        notifications.push(proposalId);
      },
    });
    const records = new MemoryRecordAppender();
    const frame = new KernelContextManager(records, {
      sanitize: async () => ({ approved: false }),
    }).activeFrame;
    await executor.execute(campaign.job, frame);
    expect(operations).toEqual([
      "evolution.inspect",
      "evolution.run",
      "evolution.resume",
      "evolution.compare",
      "evolution.propose",
    ]);
    expect(notifications).toEqual(["prp_scheduled"]);
    expect(argumentsByOperation.get("evolution.run")).toEqual([
      "workspace/skill/review",
      "--engine",
      "organization/evaluator/dspy-gepa",
      "--signal",
      "signal-weak-target",
    ]);
    expect(operations).not.toContain("proposal.approve");
    expect(operations).not.toContain("release.promote");
  });

  it("refreshes a durable recurring job when the active target changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-job-refresh-"));
    roots.push(root);
    const store = new SessionStore(path.join(root, "continuous.sqlite"));
    const first = makeEvolutionScheduledBenchmark({
      jobId: "benchmark-refresh",
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:old",
      runAt: new Date(1).toISOString(),
      cron: "* * * * *",
    }).job;
    await store.schedule(first);
    expect(await store.replaceScheduledIfPayloadChanged(first)).toBeFalse();
    const refreshed = makeEvolutionScheduledBenchmark({
      jobId: first.id,
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:new",
      runAt: new Date(2).toISOString(),
      cron: "* * * * *",
    }).job;
    expect(
      await store.replaceScheduledIfPayloadChanged(refreshed),
    ).toBeTrue();
    const leased = await store.leaseDue(new Date(2), "worker", 1);
    expect(leased[0]?.job.payload["targetDigest"]).toBe("sha256:new");
    store.close();
  });

  it("runs a recurring benchmark with evaluation-only authority", async () => {
    const benchmark = makeEvolutionScheduledBenchmark({
      jobId: "benchmark-authority",
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      runAt: new Date(0).toISOString(),
      cron: "0 3 * * 0",
    });
    expect(
      benchmark.job.requestedCapabilities.map((item) => item.capability),
    ).toEqual(["evolution.target.read", "evaluation.run"]);
    const operations: string[] = [];
    const frames: string[] = [];
    const completed: string[] = [];
    const operator = makeScheduledEvolutionOperator({
      currentSnapshotId: () => "snapshot:current",
      grantedCapabilities: benchmark.job.requestedCapabilities.map((item) =>
        item.capability
      ),
      executor: {
        execute: async (_authority, request) => {
          operations.push(request.operation);
          return { baselineDigest: "sha256:target" };
        },
      },
      runBenchmark: async (input) => {
        frames.push(input.frame);
        expect(input).toMatchObject({
          targetRef: "workspace/skill/review",
          targetDigest: "sha256:target",
          principalId: "scheduler/evolution",
          snapshotId: "snapshot:current",
        });
        return { passed: true, reportDigest: "sha256:benchmark" };
      },
      onBenchmarkCompleted: async (_targetRef, _passed, reportDigest) => {
        completed.push(reportDigest);
      },
    });
    const records = new MemoryRecordAppender();
    const firstFrame = new KernelContextManager(records, {
      sanitize: async () => ({ approved: false }),
    }).activeFrame;
    const secondFrame = new KernelContextManager(records, {
      sanitize: async () => ({ approved: false }),
    }).activeFrame;
    await operator.execute(benchmark.job, firstFrame);
    await operator.execute(benchmark.job, secondFrame);
    expect(operations).toEqual([
      "evolution.inspect",
      "evolution.inspect",
    ]);
    expect(frames).toEqual([firstFrame, secondFrame]);
    expect(frames[0]).not.toBe(frames[1]);
    expect(completed).toEqual([
      "sha256:benchmark",
      "sha256:benchmark",
    ]);
  });

  it("durably projects recurring baseline benchmark results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-benchmark-"));
    roots.push(root);
    const projections = new FileEvolutionProjectionStore(
      path.join(root, "projections"),
    );
    const records = new MemoryRecordAppender();
    const frame = new KernelContextManager(records, {
      sanitize: async () => ({ approved: false }),
    }).activeFrame;
    const target = EvolutionTarget.make({
      targetClass: "skill",
      componentRef: "workspace/skill/review",
      baselineDigest: "sha256:target",
      riskClass: "C1",
      mutationPath: "review.md",
      allowedMutationPaths: ["review.md"],
      frozenPaths: [],
    });
    const outcome = await Effect.runPromise(runRecurringEvolutionBenchmark({
      target,
      baselineContent: "review skill baseline",
      principalId: "scheduler/evolution",
      snapshotId: "snapshot:current",
      frame,
      budgets: EvolutionBudgets.make({
        maximumCandidates: 1,
        maximumTokens: 1,
        maximumCostUsd: 1,
        maximumDurationMilliseconds: 1000,
        maximumConcurrency: 1,
      }),
      environmentDigest: "sha256:environment",
      seed: 0,
      runner: {
        invoke: (operation) =>
          Effect.succeed(EvolutionBenchmarkResult.make({
            benchmarkRef: operation.benchmarkRef,
            scope: "candidate",
            baselineScore: 0.8,
            candidateScore: 0.8,
            maximumRegressionRatio: 0,
            costUsd: 0.1,
            latencyMilliseconds: 10,
            reportDigest: `sha256:${operation.benchmarkRef}`,
            status: "passed",
            passed: true,
          })),
      },
      projections,
      records,
      now: () => new Date(0),
    }));
    expect(outcome.passed).toBe(true);
    // The native prompt-injection gate runs first, ahead of the 13 required
    // gates, and passes on the clean baseline artifact.
    expect(outcome.results).toHaveLength(14);
    expect(outcome.results[0]?.benchmarkRef).toBe(
      "core/evaluator/prompt-injection",
    );
    expect(outcome.results[0]?.passed).toBe(true);
    expect(outcome.projection).toMatchObject({
      targetRef: target.componentRef,
      targetDigest: target.baselineDigest,
      successRate: 1,
      sampleCount: 12,
      projectedAt: new Date(0).toISOString(),
    });
    expect(outcome.projection.benchmarkScore).toBeCloseTo(0.817);
    expect(
      new FileEvolutionProjectionStore(path.join(root, "projections"))
        .get(target.componentRef),
    ).toEqual(outcome.projection);
    expect(
      records.list().find((event) =>
        event.type === "evolution.baseline.completed"
      )?.payload,
    ).toMatchObject({
      targetRef: target.componentRef,
      targetDigest: target.baselineDigest,
      snapshotId: "snapshot:current",
      frameId: frame,
      reportDigest: outcome.reportDigest,
      passed: true,
    });
  });

  it("selects the weakest fresh durable projection before scheduling", () => {
    const first = EvolutionTarget.make({
      targetClass: "skill",
      componentRef: "workspace/skill/first",
      baselineDigest: "sha256:first",
      riskClass: "C1",
      mutationPath: "first.md",
      allowedMutationPaths: ["first.md"],
      frozenPaths: [],
    });
    const second = EvolutionTarget.make({
      ...first,
      componentRef: "workspace/skill/second",
      baselineDigest: "sha256:second",
      mutationPath: "second.md",
      allowedMutationPaths: ["second.md"],
    });
    const projections = [
      EvolutionPerformanceProjection.make({
        targetRef: first.componentRef,
        targetClass: first.targetClass,
        targetDigest: first.baselineDigest,
        successRate: 0.9,
        correctionRate: 0.1,
        benchmarkScore: 0.9,
        averageCostUsd: 1,
        sampleCount: 10,
        projectedAt: new Date(0).toISOString(),
      }),
      EvolutionPerformanceProjection.make({
        targetRef: second.componentRef,
        targetClass: second.targetClass,
        targetDigest: second.baselineDigest,
        successRate: 0.2,
        correctionRate: 0.6,
        benchmarkScore: 0.3,
        averageCostUsd: 1,
        sampleCount: 10,
        projectedAt: new Date(0).toISOString(),
      }),
    ];
    const input = {
      targets: [first, second],
      projections,
      feedbackByTarget: new Map(),
      activeTargetRefs: new Set<string>(),
      activeRunCount: 0,
      maximumConcurrentRuns: 1,
      monthlySpentUsd: 0,
      monthlyBudgetUsd: 10,
      maximumRiskClass: "C2" as const,
      estimatedCampaignCostUsd: 1,
    };
    expect(selectRuntimeEvolutionSignal(input).selected?.targetRef).toBe(
      second.componentRef,
    );
    expect(
      selectRuntimeEvolutionSignal({
        ...input,
        cooldownTargetRefs: new Set([second.componentRef]),
      }).selected?.targetRef,
    ).toBe(first.componentRef);
    expect(
      selectRuntimeEvolutionSignal({
        ...input,
        projections: [
          projections[0]!,
          EvolutionPerformanceProjection.make({
            ...projections[1]!,
            targetDigest: "sha256:stale",
          }),
        ],
      }).selected?.targetRef,
    ).toBe(first.componentRef);
  });

  it("selects a digest-bound runtime tool failure as a weak target", () => {
    const target = EvolutionTarget.make({
      targetClass: "tool-description",
      componentRef: "core/tool/search-brave",
      baselineDigest: "sha256:active-description",
      riskClass: "C1",
      mutationPath: "catalog/tools/search-brave.md",
      allowedMutationPaths: ["catalog/tools/search-brave.md"],
      frozenPaths: [],
    });
    const selection = selectRuntimeEvolutionSignal({
      targets: [target],
      projections: [],
      feedbackByTarget: new Map(),
      toolFailuresByTarget: new Map([[
        target.componentRef,
        {
          totalCalls: 4,
          failures: [{
            id: "tool-call-failed",
            runId: "run",
            requestedTool: "brave_search",
            selectedTool: "brave_search",
            schemaDigest: "sha256:schema",
            resultDigest: "sha256:result",
            latencyMilliseconds: 10,
            errorTag: "network-error",
            createdAt: new Date(0).toISOString(),
          }],
        },
      ]]),
      activeTargetRefs: new Set(),
      activeRunCount: 0,
      maximumConcurrentRuns: 1,
      monthlySpentUsd: 0,
      monthlyBudgetUsd: 10,
      maximumRiskClass: "C2",
      estimatedCampaignCostUsd: 1,
    });
    expect(selection.selected).toMatchObject({
      id: "tool-failure-tool-call-failed",
      targetRef: target.componentRef,
      targetClass: "tool-description",
      source: "tool-failure",
      strength: 1,
      usageFrequency: 4,
      expectedImpact: 0.25,
    });
  });

  it("projects durable target performance from a comparison report", () => {
    const run = {
      target: {
        componentRef: "workspace/skill/review",
        targetClass: "skill" as const,
        baselineDigest: "sha256:target",
      },
    };
    const projection = projectEvolutionPerformance(
      run,
      {
        candidateCases: [
          { passed: true },
          { passed: false },
        ],
        benchmarks: [{
          status: "passed",
          candidateScore: 0.75,
        }],
        metrics: [],
        totalCostUsd: 2,
        createdAt: new Date(0).toISOString(),
      },
      0.25,
    );
    expect(projection).toMatchObject({
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      successRate: 0.5,
      correctionRate: 0.25,
      benchmarkScore: 0.75,
      averageCostUsd: 1,
      sampleCount: 2,
    });
  });

  it("does no work when live triage skips a scheduled target", async () => {
    const campaign = makeEvolutionScheduledCampaign({
      jobId: "campaign-not-selected",
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      engineRef: "organization/evaluator/dspy-gepa",
      runAt: new Date(0).toISOString(),
    });
    const operations: string[] = [];
    const operator = makeScheduledEvolutionOperator({
      executor: {
        execute: async (_authority, request) => {
          operations.push(request.operation);
        },
      },
      currentSnapshotId: () => "snapshot:current",
      grantedCapabilities: SCHEDULER_CAPABILITIES,
      campaignDecision: async () => "skip",
    });
    const records = new MemoryRecordAppender();
    await operator.execute(
      campaign.job,
      new KernelContextManager(records, {
        sanitize: async () => ({ approved: false }),
      }).activeFrame,
    );
    expect(operations).toEqual([]);
  });

  it("stops a scheduled operator at the runtime cost/concurrency gate", async () => {
    const campaign = makeEvolutionScheduledCampaign({
      jobId: "campaign-blocked",
      principalId: "scheduler/evolution",
      agentRef: "core/agent/evolution",
      targetRef: "workspace/skill/review",
      targetDigest: "sha256:target",
      engineRef: "organization/evaluator/dspy-gepa",
      runAt: new Date(0).toISOString(),
    });
    const operations: string[] = [];
    const operator = makeScheduledEvolutionOperator({
      executor: {
        execute: async (_authority, request) => {
          operations.push(request.operation);
        },
      },
      currentSnapshotId: () => "snapshot:current",
      grantedCapabilities: SCHEDULER_CAPABILITIES,
      permitCampaign: async () => false,
    });
    const records = new MemoryRecordAppender();
    const frame = new KernelContextManager(records, {
      sanitize: async () => ({ approved: false }),
    }).activeFrame;
    await expect(operator.execute(campaign.job, frame)).rejects.toThrow(
      "cost or concurrency gate",
    );
    expect(operations).toEqual([]);
  });

  it("durably deduplicates runtime campaigns across restarts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-runtime-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    const baseline = "review skill baseline";
    await mkdir(path.join(root, ".elliott"), { recursive: true });
    await writeFile(path.join(root, "review.md"), baseline);
    await writeFile(
      path.join(root, ".elliott/evolution-targets.yaml"),
      [
        "targets:",
        "  - componentRef: workspace/skill/review",
        "    targetClass: skill",
        "    riskClass: C1",
        "    baselinePath: review.md",
        "    allowedMutationPaths: [review.md]",
        "    frozenPaths: []",
      ].join("\n"),
    );
    const target = EvolutionTarget.make({
      targetClass: "skill",
      componentRef: "workspace/skill/review",
      baselineDigest: hashBytes(baseline),
      riskClass: "C1",
      mutationPath: "review.md",
      allowedMutationPaths: ["review.md"],
      frozenPaths: [],
    });
    const targets: EvolutionTargetCatalogShape = {
      resolve: () => Effect.succeed({ target, baselineContent: baseline }),
      activeDigest: () => Effect.succeed(target.baselineDigest),
    };
    const executor: EvolutionControlPlaneExecutor = {
      execute: async () => {
        throw new Error("future campaign must not fire during startup");
      },
    };
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel: new AgentKernel(),
        executor,
        targets,
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
      });
    const first = makeService();
    expect(first).toBeDefined();
    await first?.start();
    await first?.stop();
    const second = makeService();
    await second?.start();
    await second?.stop();

    const store = new SessionStore(path.join(stateRoot, "continuous.sqlite"));
    const jobs = await store.leaseDue(
      new Date("9999-12-31T23:59:59.999Z"),
      "audit",
      10,
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.job.principal === "scheduler/evolution"))
      .toBe(true);
    expect(
      new Set(jobs.map((job) => job.job.payload["operation"])),
    ).toEqual(
      new Set([
        "evolution.recurring-benchmark",
        "evolution.continuous-campaign",
      ]),
    );
    expect(
      jobs.find((job) =>
        job.job.payload["operation"] === "evolution.recurring-benchmark"
      )?.job.recurrence?.cron,
    ).toBe("0 3 * * 0");
    expect(
      jobs.find((job) =>
        job.job.payload["operation"] === "evolution.continuous-campaign"
      )?.job.recurrence?.cron,
    ).toBe("0 4 * * 0");
    store.close();
  });

  it("rejects privileged or shared continuous-evolution authority", () => {
    const input = {
      root: ".",
      stateRoot: ".",
      timeZone: "UTC",
      config: continuousConfig(),
      kernel: new AgentKernel(),
      executor: {
        execute: async () => undefined,
      } satisfies EvolutionControlPlaneExecutor,
      targets: {
        resolve: () => Effect.die("unused"),
        activeDigest: () => Effect.die("unused"),
      } satisfies EvolutionTargetCatalogShape,
      currentSnapshotId: () => "snapshot:current",
      environmentDigest: "sha256:environment",
    };
    expect(() =>
      makeRuntimeContinuousEvolutionService({
        ...input,
        runtime: runtimeSettings({
          schedulerCapabilities: ["proposal.approve"],
        }),
      })
    ).toThrow();
    expect(() =>
      makeRuntimeContinuousEvolutionService({
        ...input,
        runtime: runtimeSettings({
          schedulerPrincipalId: "operator/evolution",
        }),
      })
    ).toThrow();
  });
});
