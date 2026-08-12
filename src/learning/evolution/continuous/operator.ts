/* eslint-disable max-lines, max-lines-per-function, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isJsonRecord } from "../../../providers/http";
import type { ScheduledJob } from "../../../scheduler/types";
import type { FrameId } from "../../../security/ifc/types";
import type { EvolutionCliRequest } from "../cli/types";
import { recordEvolutionQueueMetric } from "../observability/index";
import type {
  EvolutionScheduledExecutionContext,
  EvolutionScheduledOperator,
  EvolutionScheduledOperatorInput,
  EvolutionScheduledRunSummary,
} from "./types";

const MAXIMUM_RESUME_SLICES = 512;
const RESUME_DELAY = "100 millis";

const OPERATION_CAPABILITIES = new Map<
  EvolutionCliRequest["operation"],
  string
>([
  ["evolution.inspect", "evolution.target.read"],
  ["evolution.run", "evolution.engine.invoke"],
  ["evolution.resume", "evolution.engine.invoke"],
  ["evolution.compare", "evaluation.run"],
  ["evolution.propose", "proposal.author"],
]);

const requiredPayloadString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`scheduled evolution payload requires ${key}`);
  }
  return value;
};

const decodeRunSummary = (value: unknown): EvolutionScheduledRunSummary => {
  if (
    !isJsonRecord(value)
    || typeof value["runId"] !== "string"
    || typeof value["state"] !== "string"
    || !Array.isArray(value["candidateIds"])
    || value["candidateIds"].some((item) => typeof item !== "string")
  ) throw new TypeError("scheduled evolution run returned an invalid summary");
  return {
    runId: value["runId"],
    state: value["state"],
    candidateIds: value["candidateIds"] as readonly string[],
  };
};

const assertTargetDigest = (value: unknown, expected: string): void => {
  if (!isJsonRecord(value) || value["baselineDigest"] !== expected) {
    throw new Error("scheduled evolution target changed before fire");
  }
};

const reportPassed = (value: unknown, candidateId: string): boolean =>
  isJsonRecord(value)
  && value["candidateId"] === candidateId
  && value["passed"] === true;

const proposalId = (value: unknown): string => {
  if (!isJsonRecord(value) || typeof value["id"] !== "string") {
    throw new TypeError("scheduled evolution did not author a Proposal");
  }
  return value["id"];
};

const makeExecutionContext = (
  input: EvolutionScheduledOperatorInput,
  job: ScheduledJob,
  snapshotId: string,
): EvolutionScheduledExecutionContext => {
  const granted = new Set(input.grantedCapabilities);
  const requested = new Set(
    job.requestedCapabilities.map((item) => item.capability),
  );
  const requireCapability = (capability: string): void => {
    if (!granted.has(capability) || !requested.has(capability)) {
      throw new Error(`scheduler lacks ${capability}`);
    }
  };
  return {
    snapshotId,
    requireCapability,
    execute: async (request) => {
      const capability = OPERATION_CAPABILITIES.get(request.operation);
      if (capability === undefined) {
        throw new Error(`scheduler lacks ${request.operation}`);
      }
      requireCapability(capability);
      return input.executor.execute({
        principalId: job.principal,
        snapshotId,
        authorize: async (candidate) =>
          granted.has(candidate) && requested.has(candidate),
      }, request);
    },
  };
};

const activeSnapshot = (input: EvolutionScheduledOperatorInput): string => {
  const snapshot = input.currentSnapshotId();
  if (snapshot === undefined) {
    throw new Error("scheduled evolution requires an active Snapshot");
  }
  return snapshot;
};

const inspectTarget = async (
  input: EvolutionScheduledOperatorInput,
  execute: EvolutionScheduledExecutionContext["execute"],
  targetRef: string,
  targetDigest: string,
): Promise<void> => {
  try {
    assertTargetDigest(
      await execute({
        operation: "evolution.inspect",
        arguments: [targetRef],
      }),
      targetDigest,
    );
  } catch (error) {
    await input.onStaleTarget?.(targetRef);
    throw error;
  }
};

const executeScheduledBenchmark = async (
  input: EvolutionScheduledOperatorInput,
  job: ScheduledJob,
  frame: FrameId,
  targetRef: string,
): Promise<void> => {
  const targetDigest = requiredPayloadString(job.payload, "targetDigest");
  const context = makeExecutionContext(input, job, activeSnapshot(input));
  await inspectTarget(input, context.execute, targetRef, targetDigest);
  if (input.runBenchmark === undefined) {
    throw new Error(
      "scheduled evolution benchmark runner is unavailable",
    );
  }
  context.requireCapability("evaluation.run");
  const outcome = await input.runBenchmark({
    targetRef,
    targetDigest,
    principalId: job.principal,
    snapshotId: context.snapshotId,
    frame,
  });
  await input.onBenchmarkCompleted?.(
    targetRef,
    outcome.passed,
    outcome.reportDigest,
  );
};

const completeScheduledCampaign = async (
  input: EvolutionScheduledOperatorInput,
  execute: EvolutionScheduledExecutionContext["execute"],
  targetRef: string,
  engineRef: string,
  signalId?: string,
): Promise<void> => {
  const initial = decodeRunSummary(
    await execute({
      operation: "evolution.run",
      arguments: [
        targetRef,
        "--engine",
        engineRef,
        ...(signalId === undefined ? [] : ["--signal", signalId]),
      ],
    }),
  );
  const resume = Effect.tryPromise(() =>
    execute({
      operation: "evolution.resume",
      arguments: [initial.runId],
    })
  ).pipe(Effect.map(decodeRunSummary));
  const completed = initial.state === "optimizing"
    ? await Effect.runPromise(resume.pipe(
      Effect.repeat({
        while: (summary) => summary.state === "optimizing",
        schedule: Schedule.spaced(RESUME_DELAY),
        times: MAXIMUM_RESUME_SLICES,
      }),
    ))
    : initial;
  if (completed.state !== "shortlisted") return;
  const candidateId = completed.candidateIds[0];
  if (candidateId === undefined) return;
  const report = await execute({
    operation: "evolution.compare",
    arguments: [completed.runId, "--candidate", candidateId],
  });
  const passed = reportPassed(report, candidateId);
  await input.onRunCompleted?.(completed.runId, candidateId, passed);
  if (!passed) return;
  const proposal = proposalId(
    await execute({
      operation: "evolution.propose",
      arguments: [completed.runId, "--candidate", candidateId],
    }),
  );
  await input.onProposalReady?.(proposal, completed.runId);
};

const executeScheduledCampaign = async (
  input: EvolutionScheduledOperatorInput,
  job: ScheduledJob,
  targetRef: string,
): Promise<void> => {
  const decision = await input.campaignDecision?.(targetRef);
  if (decision === "skip") return;
  if (decision === "budget-exhausted") {
    throw new Error("scheduled evolution budget gate is closed");
  }
  if (
    input.permitCampaign !== undefined
    && !(await input.permitCampaign(targetRef))
  ) throw new Error("scheduled evolution cost or concurrency gate is closed");
  try {
    const targetDigest = requiredPayloadString(job.payload, "targetDigest");
    const context = makeExecutionContext(input, job, activeSnapshot(input));
    await inspectTarget(input, context.execute, targetRef, targetDigest);
    await completeScheduledCampaign(
      input,
      context.execute,
      targetRef,
      requiredPayloadString(job.payload, "engineRef"),
      typeof decision === "object" ? decision.signalId : undefined,
    );
  } finally {
    await input.completeCampaign?.(targetRef);
  }
};

export const makeScheduledEvolutionOperator = (
  input: EvolutionScheduledOperatorInput,
): EvolutionScheduledOperator => ({
  execute: async (job, frame) => {
    const startedAt = Date.now();
    const scheduledOperation = job.payload["operation"];
    if (
      scheduledOperation !== "evolution.continuous-campaign"
      && scheduledOperation !== "evolution.recurring-benchmark"
    ) {
      throw new TypeError("unsupported scheduled evolution operation");
    }
    const targetRef = requiredPayloadString(job.payload, "targetRef");
    try {
      return await (
        scheduledOperation === "evolution.recurring-benchmark"
          ? executeScheduledBenchmark(input, job, frame, targetRef)
          : executeScheduledCampaign(input, job, targetRef)
      );
    } finally {
      const finishedAt = Date.now();
      await Effect.runPromise(recordEvolutionQueueMetric(
        Math.max(0, startedAt - new Date(job.runAt).getTime()),
        Math.max(0, finishedAt - startedAt),
      ));
    }
  },
});
