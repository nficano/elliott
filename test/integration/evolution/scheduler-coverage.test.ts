import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest, principalId } from "../../../src/core/brands";
import { hashBytes } from "../../../src/core/digest";
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
} from "../../../src/learning/evolution/continuous/index";
import {
  AwaitingReviewRunState,
  EvolutionBaselineFootprint,
  EvolutionBaselineReport,
  EvolutionBaselineReportIdSchema,
  EvolutionBenchmarkResult,
  EvolutionBudgets,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionCaseResult,
  EvolutionEvaluationReport,
  EvolutionEvaluationReportIdSchema,
  EvolutionFootprintResult,
  EvolutionPerformanceProjection,
  EvolutionRelease,
  EvolutionReleaseIdSchema,
  EvolutionRollbackMetadata,
  EvolutionRun,
  EvolutionRunIdSchema,
  EvolutionStatisticalComparison,
  EvolutionTarget,
  OptimizingRunState,
} from "../../../src/learning/evolution/model/index";
import {
  makeEvolutionBaselineReportStore,
  makeEvolutionCandidateStore,
  makeEvolutionEvaluationReportStore,
  makeEvolutionReleaseMonitorReportStore,
  makeEvolutionReleaseStore,
  makeEvolutionRunStore,
} from "../../../src/learning/evolution/store/index";
import { FileProposalStore } from "../../../src/learning/proposals/index";
import { runtimeEnvironment } from "../../../src/runtime/config";
import { makeRuntimeContinuousEvolutionService } from "../../../src/runtime/evolution-scheduler";
import type { RuntimeEvolutionSettings } from "../../../src/runtime/types";

// Tests temporarily poke ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES through the
// shared config boundary; the export is typed read-only.
const mutableRuntimeEnvironment = runtimeEnvironment as Record<
  string,
  string | undefined
>;

const roots: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const SCHEDULER_CAPABILITIES_ENV = "ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES";
const PAST_RUN_AT = "1970-01-01T00:00:00.000Z";
const SCHEDULER_CAPABILITIES = [
  "evolution.target.read",
  "evolution.dataset.read",
  "evolution.engine.invoke",
  "evolution.candidate.write",
  "evaluation.run",
  "proposal.author",
] as const;

afterEach(async () => {
  delete mutableRuntimeEnvironment[SCHEDULER_CAPABILITIES_ENV];
  const pendingServers = [...servers];
  servers.length = 0;
  for (const server of pendingServers) {
    void server.stop(true);
  }
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const continuousConfig = (
  overrides: Partial<EvolutionConfig["continuous"]> = {},
) =>
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
      ...overrides,
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

const weakProjection = (
  targetRef: string,
  targetDigest: string,
  score = 0.2,
) =>
  EvolutionPerformanceProjection.make({
    targetRef,
    targetClass: "skill",
    targetDigest,
    successRate: score,
    correctionRate: 0.6,
    benchmarkScore: score,
    averageCostUsd: 1,
    sampleCount: 10,
    projectedAt: new Date(0).toISOString(),
  });

const writeSkillTarget = async (
  root: string,
  input: {
    readonly componentRef: string;
    readonly baselinePath: string;
    readonly baseline: string;
    readonly riskClass?: "C1" | "C2" | "C3" | "C4";
  },
) => {
  await writeFile(path.join(root, input.baselinePath), input.baseline);
  return EvolutionTarget.make({
    targetClass: "skill",
    componentRef: input.componentRef,
    baselineDigest: hashBytes(input.baseline),
    riskClass: input.riskClass ?? "C1",
    mutationPath: input.baselinePath,
    allowedMutationPaths: [input.baselinePath],
    frozenPaths: [],
  });
};

const writeTargetsDocument = async (
  root: string,
  targets: readonly EvolutionTarget[],
) => {
  await mkdir(path.join(root, ".elliott"), { recursive: true });
  const body = [
    "targets:",
    ...targets.flatMap((target) => [
      `  - componentRef: ${target.componentRef}`,
      "    targetClass: skill",
      `    riskClass: ${target.riskClass}`,
      `    baselinePath: ${target.mutationPath}`,
      `    allowedMutationPaths: [${target.mutationPath}]`,
      "    frozenPaths: []",
    ]),
  ].join("\n");
  await writeFile(path.join(root, ".elliott/evolution-targets.yaml"), body);
};

const catalogFor = (
  materializations: ReadonlyMap<
    string,
    { readonly target: EvolutionTarget; readonly baselineContent: string; }
  >,
): EvolutionTargetCatalogShape => ({
  resolve: (targetRef) => {
    const materialization = materializations.get(targetRef);
    if (materialization === undefined) {
      return Effect.die(`missing target ${targetRef}`);
    }
    return Effect.succeed(materialization);
  },
  activeDigest: (targetRef) => {
    const materialization = materializations.get(targetRef);
    if (materialization === undefined) {
      return Effect.die(`missing target ${targetRef}`);
    }
    return Effect.succeed(materialization.target.baselineDigest);
  },
});

const forceDueJobs = (
  stateRoot: string,
  input: {
    readonly operations?: ReadonlySet<string>;
    readonly targetRefs?: ReadonlySet<string>;
    readonly runAtByTarget?: ReadonlyMap<string, string>;
    readonly injectForbiddenCapability?: boolean;
  } = {},
) => {
  const database = new Database(path.join(stateRoot, "continuous.sqlite"));
  try {
    const rows = database.query<
      { readonly id: string; readonly payload: string; },
      []
    >("SELECT id, payload FROM scheduled_jobs").all();
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as {
        readonly operation: string;
        readonly targetRef: string;
      };
      if (
        input.operations !== undefined
        && !input.operations.has(payload.operation)
      ) continue;
      if (
        input.targetRefs !== undefined
        && !input.targetRefs.has(payload.targetRef)
      ) continue;
      const runAt = input.runAtByTarget?.get(payload.targetRef) ?? PAST_RUN_AT;
      database.run("UPDATE scheduled_jobs SET run_at = ? WHERE id = ?", [
        runAt,
        row.id,
      ]);
      if (input.injectForbiddenCapability === true) {
        database.run(
          "UPDATE scheduled_jobs SET requested_capabilities = ? WHERE id = ?",
          [
            JSON.stringify([
              {
                capability: "proposal.approve",
                resources: [payload.targetRef],
              },
            ]),
            row.id,
          ],
        );
      }
    }
  } finally {
    database.close();
  }
};

const fixtureBudgets = () =>
  EvolutionBudgets.make({
    maximumCandidates: 1,
    maximumTokens: 1,
    maximumCostUsd: 1,
    maximumDurationMilliseconds: 60_000,
    maximumConcurrency: 1,
  });

const inspectAwareExecutor = (
  digestsByTarget: ReadonlyMap<string, string>,
  operations: string[],
): EvolutionControlPlaneExecutor => ({
  execute: async (_authority, request) => {
    operations.push(request.operation);
    switch (request.operation) {
      case "evolution.inspect": {
        const targetRef = request.arguments[0]!;
        return { baselineDigest: digestsByTarget.get(targetRef) };
      }
      case "evolution.run": {
        return {
          runId: "evr_scheduled01",
          state: "optimizing",
          candidateIds: [],
        };
      }
      case "evolution.resume": {
        return {
          runId: "evr_scheduled01",
          state: "shortlisted",
          candidateIds: ["evc_scheduled01"],
        };
      }
      case "evolution.compare": {
        return { candidateId: "evc_scheduled01", passed: true };
      }
      case "evolution.propose": {
        return { id: "prp_scheduled01" };
      }
      default: {
        throw new Error(`forbidden operation ${request.operation}`);
      }
    }
  },
});

const openServiceDeps = async (stateRoot: string, kernel: AgentKernel) => {
  const proposals = await FileProposalStore.open({
    root: path.join(stateRoot, "proposals"),
    records: kernel.records,
  });
  return {
    proposals,
    releases: makeEvolutionReleaseStore(stateRoot),
    reports: makeEvolutionEvaluationReportStore(stateRoot),
    baselineReports: makeEvolutionBaselineReportStore(stateRoot),
    monitorReports: makeEvolutionReleaseMonitorReportStore(stateRoot),
  };
};

const startMockEvaluator = () => {
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== "/v1/run") {
        return new Response("not found", { status: 404 });
      }
      const body = await request.json() as { readonly benchmarkRef: string; };
      return Response.json({
        benchmarkRef: body.benchmarkRef,
        scope: "candidate",
        baselineScore: 0.9,
        candidateScore: 0.4,
        maximumRegressionRatio: 0,
        costUsd: 0.5,
        latencyMilliseconds: 1,
        reportDigest: `sha256:${body.benchmarkRef}`,
        status: "passed",
        passed: true,
      });
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
};

describe("runtime evolution scheduler coverage", () => {
  it("returns undefined when continuous evolution is disabled", () => {
    const service = makeRuntimeContinuousEvolutionService({
      root: ".",
      stateRoot: ".",
      timeZone: "UTC",
      config: continuousConfig({ enabled: false }),
      runtime: runtimeSettings(),
      kernel: new AgentKernel(),
      executor: { execute: async () => undefined },
      targets: {
        resolve: () => Effect.die("unused"),
        activeDigest: () => Effect.die("unused"),
      },
      currentSnapshotId: () => "snapshot:current",
      environmentDigest: "sha256:environment",
      proposals: undefined as never,
      releases: undefined as never,
      reports: undefined as never,
      baselineReports: undefined as never,
      monitorReports: undefined as never,
    });
    expect(service).toBeUndefined();
  });

  it("rejects scheduler principals that share the operator or forbid list", () => {
    const kernel = new AgentKernel();
    const base = {
      root: ".",
      stateRoot: ".",
      timeZone: "UTC",
      config: continuousConfig(),
      kernel,
      executor: {
        execute: async () => undefined,
      } satisfies EvolutionControlPlaneExecutor,
      targets: {
        resolve: () => Effect.die("unused"),
        activeDigest: () => Effect.die("unused"),
      } satisfies EvolutionTargetCatalogShape,
      currentSnapshotId: () => "snapshot:current",
      environmentDigest: "sha256:environment",
      proposals: undefined as never,
      releases: undefined as never,
      reports: undefined as never,
      baselineReports: undefined as never,
      monitorReports: undefined as never,
    };
    expect(() =>
      makeRuntimeContinuousEvolutionService({
        ...base,
        runtime: runtimeSettings({
          schedulerCapabilities: ["release.rollback"],
        }),
      })
    ).toThrow(/Proposal-only capabilities/);
    expect(() =>
      makeRuntimeContinuousEvolutionService({
        ...base,
        runtime: runtimeSettings({ schedulerCapabilities: [] }),
      })
    ).toThrow(/Proposal-only capabilities/);
  });

  it("skips a due campaign when an active concurrent run already owns the target", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-active-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    await Effect.runPromise(
      makeEvolutionRunStore(stateRoot).save(EvolutionRun.make({
        id: EvolutionRunIdSchema.make("evr_active01"),
        principalId: "scheduler/evolution",
        baselineSnapshotId: "snapshot:current",
        engineRef: "organization/evaluator/dspy-gepa",
        engineKind: "fixture",
        configurationDigest: "sha256:config",
        signalIds: [],
        target,
        budgets: fixtureBudgets(),
        state: OptimizingRunState.make({
          startedAt: new Date().toISOString(),
          candidateCount: 0,
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    );
    const operations: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: {
          execute: async (_authority, request) => {
            operations.push(request.operation);
            throw new Error("campaign body must not run after skip");
          },
        },
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        ...deps,
      });
    const first = makeService();
    await first?.start();
    await first?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
    });
    const second = makeService();
    await second?.start();
    expect(operations).toEqual([]);
    expect(second?.health().completed).toBeGreaterThan(0);
    await second?.stop();
  });

  it("pauses due campaigns when the monthly budget is exhausted and notifies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-budget-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const runId = EvolutionRunIdSchema.make("evr_budget01");
    const now = new Date().toISOString();
    await Effect.runPromise(
      makeEvolutionRunStore(stateRoot).save(
        EvolutionRun.make({
          id: runId,
          principalId: "scheduler/evolution",
          baselineSnapshotId: "snapshot:current",
          engineRef: "organization/evaluator/dspy-gepa",
          engineKind: "fixture",
          configurationDigest: "sha256:config",
          signalIds: [],
          target,
          budgets: fixtureBudgets(),
          state: AwaitingReviewRunState.make({ proposalId: "prp_budget01" }),
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );
    await Effect.runPromise(
      makeEvolutionCandidateStore(stateRoot).save(
        EvolutionCandidate.make({
          id: EvolutionCandidateIdSchema.make("evc_budget01"),
          runId,
          targetDigest: target.baselineDigest,
          candidateDigest: hashBytes("new"),
          patch: "-old\n+new",
          materializedContent: "new",
          engineTraceDigest: "sha256:trace",
          usage: EvolutionCandidateUsage.make({
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 1,
            latencyMilliseconds: 1,
          }),
          constraints: [],
          createdAt: now,
        }),
      ),
    );
    new FileEvolutionProjectionStore(path.join(stateRoot, "projections")).put(
      weakProjection(target.componentRef, target.baselineDigest),
    );
    const notifications: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: {
          execute: async () => {
            throw new Error("budget gate must stop the campaign");
          },
        },
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        notify: async (message) => {
          notifications.push(message);
        },
        ...deps,
      });
    const first = makeService();
    await first?.start();
    await first?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
    });
    const second = makeService();
    await second?.start();
    expect(
      notifications.some((message) =>
        message.includes("monthly budget is exhausted")
      ),
    ).toBe(true);
    expect(second?.health().failed).toBeGreaterThan(0);
    await second?.stop();
  });

  it("skips a second due campaign once the first target is reserved", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-reserve-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const firstBaseline = "first skill baseline";
    const secondBaseline = "second skill baseline";
    const first = await writeSkillTarget(root, {
      componentRef: "workspace/skill/first",
      baselinePath: "first.md",
      baseline: firstBaseline,
    });
    const second = await writeSkillTarget(root, {
      componentRef: "workspace/skill/second",
      baselinePath: "second.md",
      baseline: secondBaseline,
    });
    await writeTargetsDocument(root, [first, second]);
    const materializations = new Map([
      [first.componentRef, {
        target: first,
        baselineContent: firstBaseline,
      }],
      [second.componentRef, {
        target: second,
        baselineContent: secondBaseline,
      }],
    ]);
    const projections = new FileEvolutionProjectionStore(
      path.join(stateRoot, "projections"),
    );
    projections.put(
      weakProjection(first.componentRef, first.baselineDigest, 0.1),
    );
    projections.put(
      weakProjection(second.componentRef, second.baselineDigest, 0.8),
    );
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const operations: string[] = [];
    const digests = new Map([
      [first.componentRef, first.baselineDigest],
      [second.componentRef, second.baselineDigest],
    ]);
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig({ maximumConcurrentRuns: 1 }),
        runtime: runtimeSettings(),
        kernel,
        executor: inspectAwareExecutor(digests, operations),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
      runAtByTarget: new Map([
        [first.componentRef, "1970-01-01T00:00:00.000Z"],
        [second.componentRef, "1970-01-01T00:00:01.000Z"],
      ]),
    });
    const live = makeService();
    await live?.start();
    expect(operations.filter((operation) => operation === "evolution.run"))
      .toHaveLength(1);
    expect(live?.health().completed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("selects a regression signal, completes a Proposal-only campaign, and notifies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-select-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    new FileEvolutionProjectionStore(path.join(stateRoot, "projections")).put(
      weakProjection(target.componentRef, target.baselineDigest),
    );
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const notifications: string[] = [];
    const operations: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: inspectAwareExecutor(
          new Map([[target.componentRef, target.baselineDigest]]),
          operations,
        ),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        notify: async (message) => {
          notifications.push(message);
          if (message.includes("ready for review")) {
            throw new Error("notify transport failed");
          }
        },
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
    });
    const live = makeService();
    await live?.start();
    expect(operations).toEqual([
      "evolution.inspect",
      "evolution.run",
      "evolution.resume",
      "evolution.compare",
      "evolution.propose",
    ]);
    expect(
      notifications.some((message) =>
        message.includes("selected") && message.includes(target.componentRef)
      ),
    ).toBe(true);
    expect(notifications.some((message) => message.includes("completed")))
      .toBe(true);
    expect(notifications.some((message) => message.includes("Proposal")))
      .toBe(true);
    expect(live?.health().completed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("blocks due jobs when live scheduler capabilities are forbidden", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-forbid-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: {
          execute: async () => {
            throw new Error("blocked jobs must not execute");
          },
        },
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
      injectForbiddenCapability: true,
    });
    const live = makeService();
    await live?.start();
    expect(live?.health().blocked).toBeGreaterThan(0);
    await live?.stop();

    mutableRuntimeEnvironment[SCHEDULER_CAPABILITIES_ENV] =
      "evolution.target.read";
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.recurring-benchmark"]),
    });
    const envGated = makeService();
    await envGated?.start();
    expect(envGated?.health().blocked).toBeGreaterThan(0);
    await envGated?.stop();
  });

  it("runs a due benchmark, monitors an active release, and notifies on regression", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-monitor-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const runId = EvolutionRunIdSchema.make("evr_monitor01");
    const candidateId = EvolutionCandidateIdSchema.make("evc_monitor01");
    const reportId = EvolutionEvaluationReportIdSchema.make("eve_monitor01");
    const caseResult = EvolutionCaseResult.make({
      caseId: "holdout",
      split: "holdout",
      snapshotId: "snapshot:baseline",
      metricValues: { correctness: 1 },
      costUsd: 0.1,
      latencyMilliseconds: 1,
      passed: true,
    });
    const baselineReport = EvolutionBaselineReport.make({
      id: EvolutionBaselineReportIdSchema.make("evb_monitor01"),
      runId,
      targetDigest: target.baselineDigest,
      evaluatorRef: "organization/evaluator/independent",
      authoringRouteDigest: "sha256:author",
      evaluationRouteDigest: "sha256:judge",
      baselineSnapshotId: "snapshot:baseline",
      datasetDigest: "sha256:dataset",
      validationDigest: "sha256:validation",
      holdoutDigest: "sha256:holdout",
      evaluationPlanDigest: "sha256:baseline-plan",
      environmentDigest: "sha256:environment",
      seed: 1,
      caseResults: [caseResult],
      metrics: [{
        metric: "correctness",
        split: "holdout",
        value: 1,
        sampleCount: 1,
      }],
      footprints: (["prompt", "inference", "runtime"] as const).map((
        category,
      ) =>
        EvolutionBaselineFootprint.make({
          category,
          metric: category,
          value: 1,
        })
      ),
      trajectoryDigests: [],
      totalCostUsd: 0.1,
      totalLatencyMilliseconds: 1,
      createdAt: new Date(0).toISOString(),
    });
    const comparison = EvolutionEvaluationReport.make({
      id: reportId,
      runId,
      candidateId,
      evaluatorRef: baselineReport.evaluatorRef,
      authoringRouteDigest: baselineReport.authoringRouteDigest,
      evaluationRouteDigest: baselineReport.evaluationRouteDigest,
      holdoutDigest: baselineReport.holdoutDigest,
      baselineSnapshotId: baselineReport.baselineSnapshotId,
      candidateSnapshotId: "snapshot:candidate",
      datasetDigest: baselineReport.datasetDigest,
      evaluationPlanDigest: "sha256:comparison-plan",
      environmentDigest: baselineReport.environmentDigest,
      seed: baselineReport.seed,
      baselineCases: [caseResult],
      candidateCases: [caseResult],
      metrics: [],
      comparison: EvolutionStatisticalComparison.make({
        method: "deterministic",
        effectSize: 0,
        confidenceLevel: 1,
        confidenceIntervalLow: 0,
        confidenceIntervalHigh: 0,
        sampleCount: 1,
        passed: true,
      }),
      benchmarks: [
        EvolutionBenchmarkResult.make({
          benchmarkRef: "elliott-check",
          scope: "candidate",
          baselineScore: 1,
          candidateScore: 1,
          maximumRegressionRatio: 0,
          costUsd: 0,
          latencyMilliseconds: 1,
          reportDigest: "sha256:benchmark",
          status: "passed",
          passed: true,
        }),
      ],
      footprints: (["prompt", "inference", "runtime"] as const).map((
        category,
      ) =>
        EvolutionFootprintResult.make({
          category,
          metric: category,
          baseline: 1,
          candidate: 1,
          maximumRegressionRatio: 0,
          regressionRatio: 0,
          status: "passed",
          passed: true,
        })
      ),
      passed: true,
      totalCostUsd: 0.1,
      totalLatencyMilliseconds: 1,
      createdAt: new Date(0).toISOString(),
    });
    const proposal = await deps.proposals.author({
      author: principalId("author"),
      target: {
        ref: target.componentRef,
        digest: digest(target.baselineDigest),
      },
      signals: [],
      artifacts: {
        rationale: "monitor fixture",
        targetYaml: "target: review",
        patch: "",
        evidenceYaml: "passed: true",
        permissionDiffYaml: "widened: []",
        evaluationPlanYaml: "seed: 1",
        support: {},
      },
      evolution: {
        runId,
        targetClass: "skill",
        riskClass: "C1",
        candidateDigest: target.baselineDigest,
        baselineSnapshotId: "snapshot:baseline",
        candidateSnapshotId: "snapshot:candidate",
        evaluationReportId: reportId,
        datasetDigest: "sha256:dataset",
      },
    });
    await Effect.runPromise(deps.baselineReports.save(baselineReport));
    await Effect.runPromise(deps.reports.save(comparison));
    await Effect.runPromise(deps.releases.save(EvolutionRelease.make({
      id: EvolutionReleaseIdSchema.make("evl_monitor01"),
      runId,
      proposalId: proposal.id,
      candidateId,
      targetRef: target.componentRef,
      targetDigest: target.baselineDigest,
      revisionDigest: "sha256:revision",
      snapshotId: "snapshot:candidate",
      rollback: EvolutionRollbackMetadata.make({
        previousTargetDigest: target.baselineDigest,
        previousRevisionDigest: "sha256:previous-revision",
        previousSnapshotId: "snapshot:baseline",
        candidateRevisionDigest: "sha256:revision",
        candidateSnapshotId: "snapshot:candidate",
      }),
      promotedBy: "operator",
      promotedAt: new Date(0).toISOString(),
      status: "active",
    })));
    const endpoint = startMockEvaluator();
    const notifications: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings({ evaluatorEndpoint: endpoint }),
        kernel,
        executor: inspectAwareExecutor(
          new Map([[target.componentRef, target.baselineDigest]]),
          [],
        ),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        notify: async (message) => {
          notifications.push(message);
        },
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.recurring-benchmark"]),
    });
    const live = makeService();
    await live?.start();
    expect(
      notifications.some((message) => message.includes("baseline benchmark")),
    ).toBe(true);
    expect(
      notifications.some((message) =>
        message.includes("regressed") || message.includes("rollback")
      ),
    ).toBe(true);
    expect(live?.health().completed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("reads tool-failure evidence for tool-description targets during campaign triage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-tool-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "tool description baseline";
    await writeFile(path.join(root, "search.md"), baseline);
    await mkdir(path.join(root, ".elliott"), { recursive: true });
    await writeFile(
      path.join(root, ".elliott/evolution-targets.yaml"),
      [
        "targets:",
        "  - componentRef: workspace/skill/search-tool",
        "    targetClass: tool-description",
        "    riskClass: C1",
        "    baselinePath: search.md",
        "    allowedMutationPaths: [search.md]",
        "    frozenPaths: []",
      ].join("\n"),
    );
    const target = EvolutionTarget.make({
      targetClass: "tool-description",
      componentRef: "workspace/skill/search-tool",
      baselineDigest: hashBytes(baseline),
      riskClass: "C1",
      mutationPath: "search.md",
      allowedMutationPaths: ["search.md"],
      frozenPaths: [],
    });
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    new FileEvolutionProjectionStore(path.join(stateRoot, "projections")).put(
      weakProjection(target.componentRef, target.baselineDigest),
    );
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const operations: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: inspectAwareExecutor(
          new Map([[target.componentRef, target.baselineDigest]]),
          operations,
        ),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
    });
    const live = makeService();
    await live?.start();
    expect(operations).toContain("evolution.run");
    await live?.stop();
  });

  it("fails monitoring when an active release lacks Proposal lineage or baselines", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "elliott-sched-monitor-err-"),
    );
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const orphanProposal = await deps.proposals.author({
      author: principalId("author"),
      target: {
        ref: target.componentRef,
        digest: digest(target.baselineDigest),
      },
      signals: [],
      artifacts: {
        rationale: "no evolution lineage",
        targetYaml: "target: review",
        patch: "",
        evidenceYaml: "passed: true",
        permissionDiffYaml: "widened: []",
        evaluationPlanYaml: "seed: 1",
        support: {},
      },
    });
    await Effect.runPromise(deps.releases.save(EvolutionRelease.make({
      id: EvolutionReleaseIdSchema.make("evl_orphan01"),
      runId: EvolutionRunIdSchema.make("evr_orphan01"),
      proposalId: orphanProposal.id,
      candidateId: EvolutionCandidateIdSchema.make("evc_orphan01"),
      targetRef: target.componentRef,
      targetDigest: target.baselineDigest,
      revisionDigest: "sha256:revision",
      snapshotId: "snapshot:candidate",
      rollback: EvolutionRollbackMetadata.make({
        previousTargetDigest: target.baselineDigest,
        previousRevisionDigest: "sha256:previous-revision",
        previousSnapshotId: "snapshot:baseline",
        candidateRevisionDigest: "sha256:revision",
        candidateSnapshotId: "snapshot:candidate",
      }),
      promotedBy: "operator",
      promotedAt: new Date(0).toISOString(),
      status: "active",
    })));
    const endpoint = startMockEvaluator();
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings({ evaluatorEndpoint: endpoint }),
        kernel,
        executor: inspectAwareExecutor(
          new Map([[target.componentRef, target.baselineDigest]]),
          [],
        ),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.recurring-benchmark"]),
    });
    const live = makeService();
    await live?.start();
    expect(live?.health().failed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("fails monitoring when an active release has Proposal lineage but no baseline", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "elliott-sched-no-baseline-"),
    );
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const runId = EvolutionRunIdSchema.make("evr_nobase01");
    const reportId = EvolutionEvaluationReportIdSchema.make("eve_nobase01");
    const proposal = await deps.proposals.author({
      author: principalId("author"),
      target: {
        ref: target.componentRef,
        digest: digest(target.baselineDigest),
      },
      signals: [],
      artifacts: {
        rationale: "missing baseline",
        targetYaml: "target: review",
        patch: "",
        evidenceYaml: "passed: true",
        permissionDiffYaml: "widened: []",
        evaluationPlanYaml: "seed: 1",
        support: {},
      },
      evolution: {
        runId,
        targetClass: "skill",
        riskClass: "C1",
        candidateDigest: target.baselineDigest,
        baselineSnapshotId: "snapshot:baseline",
        candidateSnapshotId: "snapshot:candidate",
        evaluationReportId: reportId,
        datasetDigest: "sha256:dataset",
      },
    });
    await Effect.runPromise(deps.releases.save(EvolutionRelease.make({
      id: EvolutionReleaseIdSchema.make("evl_nobase01"),
      runId,
      proposalId: proposal.id,
      candidateId: EvolutionCandidateIdSchema.make("evc_nobase01"),
      targetRef: target.componentRef,
      targetDigest: target.baselineDigest,
      revisionDigest: "sha256:revision",
      snapshotId: "snapshot:candidate",
      rollback: EvolutionRollbackMetadata.make({
        previousTargetDigest: target.baselineDigest,
        previousRevisionDigest: "sha256:previous-revision",
        previousSnapshotId: "snapshot:baseline",
        candidateRevisionDigest: "sha256:revision",
        candidateSnapshotId: "snapshot:candidate",
      }),
      promotedBy: "operator",
      promotedAt: new Date(0).toISOString(),
      status: "active",
    })));
    const endpoint = startMockEvaluator();
    const makeBaselineAbsentService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings({ evaluatorEndpoint: endpoint }),
        kernel,
        executor: inspectAwareExecutor(
          new Map([[target.componentRef, target.baselineDigest]]),
          [],
        ),
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment-missing-baseline",
        ...deps,
      });
    const primed = makeBaselineAbsentService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.recurring-benchmark"]),
    });
    const live = makeBaselineAbsentService();
    await live?.start();
    expect(live?.health().failed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("notifies on stale targets when inspect rejects the scheduled digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-stale-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const baseline = "review skill baseline";
    const target = await writeSkillTarget(root, {
      componentRef: "workspace/skill/review",
      baselinePath: "review.md",
      baseline,
    });
    await writeTargetsDocument(root, [target]);
    const materializations = new Map([[target.componentRef, {
      target,
      baselineContent: baseline,
    }]]);
    new FileEvolutionProjectionStore(path.join(stateRoot, "projections")).put(
      weakProjection(target.componentRef, target.baselineDigest),
    );
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const notifications: string[] = [];
    const makeService = () =>
      makeRuntimeContinuousEvolutionService({
        root,
        stateRoot,
        timeZone: "UTC",
        config: continuousConfig(),
        runtime: runtimeSettings(),
        kernel,
        executor: {
          execute: async (_authority, request) => {
            if (request.operation === "evolution.inspect") {
              return { baselineDigest: "sha256:stale-other" };
            }
            throw new Error(`unexpected ${request.operation}`);
          },
        },
        targets: catalogFor(materializations),
        currentSnapshotId: () => "snapshot:current",
        environmentDigest: "sha256:environment",
        notify: async (message) => {
          notifications.push(message);
        },
        ...deps,
      });
    const primed = makeService();
    await primed?.start();
    await primed?.stop();
    forceDueJobs(stateRoot, {
      operations: new Set(["evolution.continuous-campaign"]),
    });
    const live = makeService();
    await live?.start();
    expect(notifications.some((message) => message.includes("stale"))).toBe(
      true,
    );
    expect(live?.health().failed).toBeGreaterThan(0);
    await live?.stop();
  });

  it("omits targets above the configured maximum risk class while refreshing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sched-risk-"));
    roots.push(root);
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    const allowedBaseline = "allowed skill";
    const deniedBaseline = "denied skill";
    const allowed = await writeSkillTarget(root, {
      componentRef: "workspace/skill/allowed",
      baselinePath: "allowed.md",
      baseline: allowedBaseline,
      riskClass: "C1",
    });
    const denied = await writeSkillTarget(root, {
      componentRef: "workspace/skill/denied",
      baselinePath: "denied.md",
      baseline: deniedBaseline,
      riskClass: "C3",
    });
    await writeTargetsDocument(root, [allowed, denied]);
    const materializations = new Map([
      [allowed.componentRef, {
        target: allowed,
        baselineContent: allowedBaseline,
      }],
      [denied.componentRef, {
        target: denied,
        baselineContent: deniedBaseline,
      }],
    ]);
    const kernel = new AgentKernel();
    const deps = await openServiceDeps(stateRoot, kernel);
    const service = makeRuntimeContinuousEvolutionService({
      root,
      stateRoot,
      timeZone: "UTC",
      config: continuousConfig({ maximumRiskClass: "C2" }),
      runtime: runtimeSettings(),
      kernel,
      executor: { execute: async () => undefined },
      targets: catalogFor(materializations),
      currentSnapshotId: () => "snapshot:current",
      environmentDigest: "sha256:environment",
      ...deps,
    });
    await service?.start();
    const database = new Database(path.join(stateRoot, "continuous.sqlite"));
    const payloads = database.query<
      { readonly payload: string; },
      []
    >("SELECT payload FROM scheduled_jobs").all().map((row) =>
      JSON.parse(row.payload) as { readonly targetRef: string; }
    );
    database.close();
    expect(
      payloads.every((payload) => payload.targetRef === allowed.componentRef),
    ).toBe(true);
    expect(
      payloads.some((payload) => payload.targetRef === denied.componentRef),
    ).toBe(false);
    await service?.stop();
  });
});
