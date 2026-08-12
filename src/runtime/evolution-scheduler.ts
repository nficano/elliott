/* eslint-disable max-lines, max-lines-per-function, max-statements, better-max-params/better-max-params */
import * as Cron from "effect/Cron";
import * as Effect from "effect/Effect";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { scopeId } from "../core/brands";
import { hashValue } from "../core/digest";
import type { AgentKernel } from "../kernel";
import {
  listFileEvolutionTargetRefs,
} from "../learning/evolution/application/files";
import type { EvolutionTargetCatalogShape } from "../learning/evolution/application/types";
import {
  makeHttpEvolutionBenchmarkRunner,
  unavailableEvolutionBenchmarkRunner,
} from "../learning/evolution/benchmarks/index";
import type { EvolutionControlPlaneExecutor } from "../learning/evolution/cli/types";
import type { EvolutionConfig } from "../learning/evolution/config";
import {
  FileEvolutionProjectionStore,
  makeEvolutionScheduledBenchmark,
  makeEvolutionScheduledCampaign,
  makeScheduledEvolutionOperator,
  runRecurringEvolutionBenchmark,
} from "../learning/evolution/continuous/index";
import { EvolutionBudgets } from "../learning/evolution/model/index";
import {
  EvolutionEvaluationReportIdSchema,
} from "../learning/evolution/model/index";
import type {
  EvolutionPerformanceProjection,
  EvolutionTarget,
} from "../learning/evolution/model/index";
import {
  recordEvolutionMonthlyBudgetMetric,
} from "../learning/evolution/observability/index";
import {
  makeEvolutionReleaseMonitor,
} from "../learning/evolution/release/monitor";
import {
  makeEvolutionCandidateStore,
  makeEvolutionRunStore,
} from "../learning/evolution/store/index";
import type {
  EvolutionBaselineReportStoreShape,
  EvolutionEvaluationReportStoreShape,
  EvolutionReleaseMonitorReportStoreShape,
  EvolutionReleaseStoreShape,
} from "../learning/evolution/types";
import type { FileProposalStore } from "../learning/proposals/index";
import { SessionStore } from "../memory/session-store/index";
import { Scheduler } from "../scheduler/index";
import { KernelContextManager } from "../security/ifc/context-manager";
import { runtimeEnvironment } from "./config";
import { selectRuntimeEvolutionSignal } from "./evolution-signals";
import type {
  RuntimeContinuousEvolutionService,
  RuntimeEvolutionSettings,
} from "./types";

const TICK_INTERVAL_MILLISECONDS = 30_000;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const CAMPAIGN_COOLDOWN_MILLISECONDS = DAYS_PER_WEEK * HOURS_PER_DAY
  * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const C1_RISK_RANK = 1;
const C2_RISK_RANK = 2;
const C3_RISK_RANK = 3;
const C4_RISK_RANK = 4;
const ISO_MONTH_LENGTH = 7;
const SCHEDULER_CAPABILITIES_ENV = "ELLIOTT_EVOLUTION_SCHEDULER_CAPABILITIES";
const FORBIDDEN_SCHEDULER_CAPABILITIES = new Set([
  "proposal.approve",
  "release.promote",
  "release.rollback",
]);
const RISK_RANK = new Map([
  ["C1", C1_RISK_RANK],
  ["C2", C2_RISK_RANK],
  ["C3", C3_RISK_RANK],
  ["C4", C4_RISK_RANK],
]);
const ACTIVE_CAMPAIGN_STATES = new Set([
  "detected",
  "scoped",
  "dataset-ready",
  "optimizing",
  "shortlisted",
  "evaluated",
]);

const capabilitiesAtFire = (
  configured: readonly string[],
): ReadonlySet<string> => {
  const live = runtimeEnvironment[SCHEDULER_CAPABILITIES_ENV];
  const values = live === undefined
    ? configured
    : live.split(",").map((item) => item.trim()).filter(Boolean);
  return new Set(values);
};

const targetPermitsScheduling = (
  targetRisk: string,
  maximumRisk: string,
): boolean =>
  (RISK_RANK.get(targetRisk) ?? Infinity)
    <= (RISK_RANK.get(maximumRisk) ?? 0);

const currentMonth = (value: string): string =>
  value.slice(0, ISO_MONTH_LENGTH);

const runtimeCampaignState = async (
  stateRoot: string,
  config: EvolutionConfig,
  reservedTargets: ReadonlySet<string>,
) => {
  const runs = await Effect.runPromise(makeEvolutionRunStore(stateRoot).list());
  const active = runs.filter((run) =>
    ACTIVE_CAMPAIGN_STATES.has(run.state._tag)
  );
  const cooldownBoundary = Date.now() - CAMPAIGN_COOLDOWN_MILLISECONDS;
  const month = currentMonth(new Date().toISOString());
  const candidates = makeEvolutionCandidateStore(stateRoot);
  let spent = 0;
  for (const run of runs) {
    if (currentMonth(run.createdAt) !== month) continue;
    const runCandidates = await Effect.runPromise(
      candidates.listForRun(run.id),
    );
    spent += runCandidates.reduce(
      (total, candidate) => total + candidate.usage.costUsd,
      0,
    );
  }
  await Effect.runPromise(recordEvolutionMonthlyBudgetMetric(month, spent));
  return {
    activeCount: active.length,
    activeTargets: new Set([
      ...active.map((run) => run.target.componentRef),
      ...reservedTargets,
    ]),
    cooldownTargets: new Set(
      runs.filter((run) =>
        !ACTIVE_CAMPAIGN_STATES.has(run.state._tag)
        && new Date(run.updatedAt).getTime() >= cooldownBoundary
      ).map((run) => run.target.componentRef),
    ),
    spent,
  };
};

const makeRuntimeCampaignGate = (
  stateRoot: string,
  sessionDatabase: string,
  config: EvolutionConfig,
  targets: readonly EvolutionTarget[],
  records: AgentKernel["records"],
  notify?: (message: string) => Promise<void>,
) => {
  const reservedTargets = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  return {
    decide: async (
      targetRef: string,
    ): Promise<
      "skip" | "budget-exhausted" | { readonly signalId: string; }
    > => {
      const previous = queue;
      const next = Promise.withResolvers<void>();
      queue = next.promise;
      await previous;
      try {
        const state = await runtimeCampaignState(
          stateRoot,
          config,
          reservedTargets,
        );
        if (
          state.activeCount + reservedTargets.size
            >= config.continuous.maximumConcurrentRuns
          || state.activeTargets.has(targetRef)
        ) return "skip";
        if (state.spent >= config.budgets.monthly.costUsd) {
          await notify?.(
            `Continuous evolution paused: monthly budget is exhausted.`,
          ).catch(() => undefined);
          return "budget-exhausted";
        }
        const sessions = new SessionStore(sessionDatabase);
        const feedbackByTarget = new Map(
          targets.map((target) => [
            target.componentRef,
            sessions.evolution.feedbackForTarget(target.componentRef),
          ]),
        );
        const toolFailuresByTarget = new Map(
          targets
            .filter((target) => target.targetClass === "tool-description")
            .map((target) => [
              target.componentRef,
              sessions.evolution.toolFailureSummaryForTarget(
                target.componentRef,
                target.baselineDigest,
              ),
            ]),
        );
        sessions.close();
        const selection = selectRuntimeEvolutionSignal({
          targets,
          projections: new FileEvolutionProjectionStore(
            path.join(stateRoot, "projections"),
          ).list(),
          feedbackByTarget,
          toolFailuresByTarget,
          cooldownTargetRefs: state.cooldownTargets,
          activeTargetRefs: state.activeTargets,
          activeRunCount: state.activeCount + reservedTargets.size,
          maximumConcurrentRuns: config.continuous.maximumConcurrentRuns,
          monthlySpentUsd: state.spent,
          monthlyBudgetUsd: config.budgets.monthly.costUsd,
          maximumRiskClass: config.continuous.maximumRiskClass,
          estimatedCampaignCostUsd: config.budgets.perRun.costUsd,
        });
        if (selection.selected?.targetRef !== targetRef) return "skip";
        reservedTargets.add(targetRef);
        await records.append({
          type: "evolution.signal.detected",
          scope: { level: "workspace", id: scopeId(targetRef) },
          durability: "observational",
          classification: "internal",
          payload: {
            signalId: selection.selected.id,
            targetRef,
            targetClass: selection.selected.targetClass,
            riskClass: selection.selected.riskClass,
            evidenceDigest: hashValue(selection.selected),
          },
        }).catch(() => undefined);
        await notify?.(
          `Evolution regression signal selected ${targetRef} for a Proposal-only campaign.`,
        ).catch(() => undefined);
        return { signalId: selection.selected.id };
      } finally {
        next.resolve();
      }
    },
    release: async (targetRef: string): Promise<void> => {
      reservedTargets.delete(targetRef);
    },
  };
};

const monitorActiveRelease = (
  input: {
    readonly targetRef: string;
    readonly projection: EvolutionPerformanceProjection;
    readonly proposals: FileProposalStore;
    readonly releases: EvolutionReleaseStoreShape;
    readonly reports: EvolutionEvaluationReportStoreShape;
    readonly baselineReports: EvolutionBaselineReportStoreShape;
    readonly monitor: ReturnType<typeof makeEvolutionReleaseMonitor>;
  },
) =>
  Effect.gen(function*() {
    const active = yield* input.releases.activeForTarget(
      input.targetRef,
    ).pipe(Effect.option);
    if (
      active._tag === "None"
      || active.value.targetDigest !== input.projection.targetDigest
    ) return;
    const release = active.value;
    const proposal = input.proposals.get(release.proposalId);
    if (proposal?.evolution === undefined) {
      throw new Error("active release has no evolution Proposal lineage");
    }
    const baselines = yield* input.baselineReports.listForRun(release.runId);
    const baseline = baselines.toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    )[0];
    if (baseline === undefined) {
      throw new Error("active release has no stored pre-optimization baseline");
    }
    const comparison = yield* input.reports.get(
      EvolutionEvaluationReportIdSchema.make(
        proposal.evolution.evaluationReportId,
      ),
    );
    yield* input.monitor.monitor({
      release,
      baseline,
      comparison,
      projection: input.projection,
    });
  });

export const makeRuntimeContinuousEvolutionService = (input: {
  readonly root: string;
  readonly stateRoot: string;
  readonly timeZone: string;
  readonly config: EvolutionConfig;
  readonly runtime: RuntimeEvolutionSettings;
  readonly kernel: AgentKernel;
  readonly executor: EvolutionControlPlaneExecutor;
  readonly targets: EvolutionTargetCatalogShape;
  readonly currentSnapshotId: () => string | undefined;
  readonly environmentDigest: string;
  readonly proposals: FileProposalStore;
  readonly releases: EvolutionReleaseStoreShape;
  readonly reports: EvolutionEvaluationReportStoreShape;
  readonly baselineReports: EvolutionBaselineReportStoreShape;
  readonly monitorReports: EvolutionReleaseMonitorReportStoreShape;
  readonly notify?: (message: string) => Promise<void>;
}): RuntimeContinuousEvolutionService | undefined => {
  if (!input.config.continuous.enabled) return undefined;
  const principal = input.runtime.schedulerPrincipalId;
  const capabilities = input.runtime.schedulerCapabilities;
  if (
    principal === undefined
    || principal === input.runtime.operatorPrincipalId
    || capabilities.length === 0
    || capabilities.some((item) => FORBIDDEN_SCHEDULER_CAPABILITIES.has(item))
  ) {
    throw new Error(
      "continuous evolution requires a distinct scheduler principal and Proposal-only capabilities",
    );
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let store: SessionStore | undefined;
  let scheduler: Scheduler | undefined;
  let completed = 0;
  let failed = 0;
  let blocked = 0;
  let refreshScheduledTargets = async (): Promise<void> => {};
  const tick = async (): Promise<void> => {
    await refreshScheduledTargets();
    const results = await scheduler?.tick(
      `runtime:${process.pid}`,
      new Date(),
    ) ?? [];
    for (const result of results) {
      if (result.type === "completed") completed += 1;
      else if (result.type === "failed") failed += 1;
      else blocked += 1;
    }
  };
  return {
    name: "evolution-continuous",
    start: async () => {
      await mkdir(input.stateRoot, { recursive: true });
      store = new SessionStore(
        path.join(input.stateRoot, "continuous.sqlite"),
      );
      const references = await Effect.runPromise(
        listFileEvolutionTargetRefs(input.root),
      );
      const eligibleTargets: EvolutionTarget[] = [];
      for (const targetRef of references) {
        const materialized = await Effect.runPromise(
          input.targets.resolve(targetRef),
        );
        if (
          targetPermitsScheduling(
            materialized.target.riskClass,
            input.config.continuous.maximumRiskClass,
          )
        ) eligibleTargets.push(materialized.target);
      }
      const campaignGate = makeRuntimeCampaignGate(
        input.stateRoot,
        path.join(path.dirname(input.stateRoot), "sessions.sqlite"),
        input.config,
        eligibleTargets,
        input.kernel.records,
        input.notify,
      );
      const projections = new FileEvolutionProjectionStore(
        path.join(input.stateRoot, "projections"),
      );
      const releaseMonitor = makeEvolutionReleaseMonitor({
        reports: input.monitorReports,
        records: input.kernel.records,
        ...(input.notify !== undefined && { notify: input.notify }),
      });
      const benchmarkRunner = input.runtime.evaluatorEndpoint === undefined
        ? unavailableEvolutionBenchmarkRunner(
          "ELLIOTT_EVOLUTION_EVALUATOR_URL is not configured",
        )
        : makeHttpEvolutionBenchmarkRunner(
          input.runtime.evaluatorEndpoint,
          globalThis.fetch,
          input.runtime.evaluatorToken,
        );
      const benchmarkBudgets = EvolutionBudgets.make({
        maximumCandidates: input.config.budgets.perRun.candidates,
        maximumTokens: input.config.budgets.perRun.tokens,
        maximumCostUsd: input.config.budgets.perRun.costUsd,
        maximumDurationMilliseconds: input.config.budgets.perRun.durationMinutes
          * MINUTES_PER_HOUR * SECONDS_PER_MINUTE
          * MILLISECONDS_PER_SECOND,
        maximumConcurrency: input.config.continuous.maximumConcurrentRuns,
      });
      const operator = makeScheduledEvolutionOperator({
        executor: input.executor,
        currentSnapshotId: input.currentSnapshotId,
        grantedCapabilities: capabilities,
        campaignDecision: campaignGate.decide,
        completeCampaign: campaignGate.release,
        runBenchmark: async ({
          targetRef,
          targetDigest,
          principalId: benchmarkPrincipalId,
          snapshotId,
          frame,
        }) => {
          const materialized = await Effect.runPromise(
            input.targets.resolve(targetRef),
          );
          if (materialized.target.baselineDigest !== targetDigest) {
            throw new Error(
              "scheduled evolution target changed before benchmark execution",
            );
          }
          const result = await Effect.runPromise(
            runRecurringEvolutionBenchmark({
              target: materialized.target,
              baselineContent: materialized.baselineContent,
              principalId: benchmarkPrincipalId,
              snapshotId,
              frame,
              budgets: benchmarkBudgets,
              environmentDigest: input.environmentDigest,
              seed: 0,
              runner: benchmarkRunner,
              projections,
              records: input.kernel.records,
            }),
          );
          await Effect.runPromise(monitorActiveRelease({
            targetRef,
            projection: result.projection,
            proposals: input.proposals,
            releases: input.releases,
            reports: input.reports,
            baselineReports: input.baselineReports,
            monitor: releaseMonitor,
          }));
          return {
            passed: result.passed,
            reportDigest: result.reportDigest,
          };
        },
        ...(input.notify !== undefined && {
          onBenchmarkCompleted: async (
            targetRef,
            passed,
            reportDigest,
          ) => {
            await input.notify?.(
              `Evolution baseline benchmark for ${targetRef} ${
                passed ? "passed" : "failed"
              } (${reportDigest}).`,
            ).catch(() => undefined);
          },
          onRunCompleted: async (runId, candidateId, passed) => {
            await input.notify?.(
              `Evolution run ${runId} completed candidate ${candidateId} with ${
                passed ? "passing" : "failing"
              } evaluation.`,
            ).catch(() => undefined);
          },
          onStaleTarget: async (targetRef) => {
            await input.notify?.(
              `Evolution campaign for ${targetRef} is stale and needs a newly scoped baseline.`,
            ).catch(() => undefined);
          },
          onProposalReady: async (proposalId, runId) => {
            await input.notify?.(
              `Evolution Proposal ${proposalId} is ready for review (run ${runId}).`,
            ).catch(() => undefined);
          },
        }),
      });
      scheduler = new Scheduler({
        store,
        authority: {
          resolve: async (_principal, requested) => {
            const live = capabilitiesAtFire(capabilities);
            return requested.every((item) =>
              live.has(item.capability)
              && !FORBIDDEN_SCHEDULER_CAPABILITIES.has(item.capability)
            );
          },
        },
        frames: {
          create: () =>
            new KernelContextManager(input.kernel.records, {
              sanitize: async () => ({ approved: false }),
            }).activeFrame,
        },
        executor: operator,
        records: input.kernel.records,
      });
      const benchmarkSchedule = input.config.continuous.benchmarkCron;
      const optimizationSchedule = input.config.continuous.optimizationCron
        ?? benchmarkSchedule;
      const scheduleTarget = async (target: EvolutionTarget) => {
        if (store === undefined) return;
        const now = new Date();
        const benchmarkRunAt = Cron.next(
          Cron.parseUnsafe(benchmarkSchedule, input.timeZone),
          now,
        ).toISOString();
        const optimizationRunAt = Cron.next(
          Cron.parseUnsafe(optimizationSchedule, input.timeZone),
          now,
        ).toISOString();
        const engineRef = target.targetClass === "code"
          ? input.config.engines.code.primary
          : input.config.engines.text.primary;
        await store.replaceScheduledIfPayloadChanged(
          makeEvolutionScheduledBenchmark({
            jobId: `evolution-benchmark-${
              Buffer.from(target.componentRef).toString("base64url")
            }`,
            principalId: principal,
            agentRef: "core/agent/evolution",
            targetRef: target.componentRef,
            targetDigest: target.baselineDigest,
            runAt: benchmarkRunAt,
            cron: benchmarkSchedule,
            timeZone: input.timeZone,
          }).job,
        );
        await store.replaceScheduledIfPayloadChanged(
          makeEvolutionScheduledCampaign({
            jobId: `evolution-campaign-${
              Buffer.from(target.componentRef).toString("base64url")
            }`,
            principalId: principal,
            agentRef: "core/agent/evolution",
            targetRef: target.componentRef,
            targetDigest: target.baselineDigest,
            engineRef,
            runAt: optimizationRunAt,
            recurrenceCron: optimizationSchedule,
            timeZone: input.timeZone,
          }).job,
        );
      };
      refreshScheduledTargets = async () => {
        for (const targetRef of references) {
          const materialized = await Effect.runPromise(
            input.targets.resolve(targetRef),
          );
          if (
            !targetPermitsScheduling(
              materialized.target.riskClass,
              input.config.continuous.maximumRiskClass,
            )
          ) continue;
          const index = eligibleTargets.findIndex((target) =>
            target.componentRef === targetRef
          );
          if (index === -1) eligibleTargets.push(materialized.target);
          else eligibleTargets[index] = materialized.target;
          await scheduleTarget(materialized.target);
        }
      };
      for (const target of eligibleTargets) {
        await scheduleTarget(target);
      }
      await tick();
      timer = setInterval(() => {
        tick().catch(() => {
          failed += 1;
        });
      }, TICK_INTERVAL_MILLISECONDS);
    },
    stop: async () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      store?.close();
      store = undefined;
      scheduler = undefined;
      refreshScheduledTargets = async () => {};
    },
    health: () => ({ completed, failed, blocked }),
  };
};
