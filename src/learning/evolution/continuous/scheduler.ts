/* eslint-disable max-lines-per-function */
import { componentRef, principalId } from "../../../core/brands";
import type {
  EvolutionBenchmarkScheduleInput,
  EvolutionScheduledCampaign,
  EvolutionScheduleInput,
} from "./types";

const FAILURE_BACKOFF_MILLISECONDS = 60_000;
const MAXIMUM_BACKOFF_MILLISECONDS = 3_600_000;
const MAXIMUM_RETRY_ATTEMPTS = 5;

export const makeEvolutionScheduledCampaign = (
  input: EvolutionScheduleInput,
): EvolutionScheduledCampaign => ({
  job: {
    id: input.jobId,
    principal: principalId(input.principalId),
    agent: componentRef(input.agentRef),
    requestedCapabilities: [
      {
        capability: "evolution.target.read",
        resources: [`${input.targetRef}@${input.targetDigest}`],
      },
      {
        capability: "evolution.dataset.read",
        resources: ["train", "validation"],
      },
      {
        capability: "evolution.engine.invoke",
        resources: [input.engineRef],
      },
      {
        capability: "evolution.candidate.write",
        resources: [input.jobId],
      },
      {
        capability: "evaluation.run",
        resources: [input.targetRef],
      },
      {
        capability: "proposal.author",
        resources: [input.targetRef],
      },
    ],
    runAt: input.runAt,
    payload: {
      operation: "evolution.continuous-campaign",
      targetRef: input.targetRef,
      targetDigest: input.targetDigest,
      engineRef: input.engineRef,
    },
    ...(input.recurrenceCron !== undefined && {
      recurrence: {
        cron: input.recurrenceCron,
        ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
        failureBackoffMilliseconds: FAILURE_BACKOFF_MILLISECONDS,
        maximumBackoffMilliseconds: MAXIMUM_BACKOFF_MILLISECONDS,
        maximumRetryAttempts: MAXIMUM_RETRY_ATTEMPTS,
      },
    }),
  },
  mayApprove: false,
  mayPromote: false,
});

export const makeEvolutionScheduledBenchmark = (
  input: EvolutionBenchmarkScheduleInput,
): EvolutionScheduledCampaign => ({
  job: {
    id: input.jobId,
    principal: principalId(input.principalId),
    agent: componentRef(input.agentRef),
    requestedCapabilities: [
      {
        capability: "evolution.target.read",
        resources: [`${input.targetRef}@${input.targetDigest}`],
      },
      {
        capability: "evaluation.run",
        resources: [input.targetRef],
      },
    ],
    runAt: input.runAt,
    payload: {
      operation: "evolution.recurring-benchmark",
      targetRef: input.targetRef,
      targetDigest: input.targetDigest,
    },
    recurrence: {
      cron: input.cron,
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
      failureBackoffMilliseconds: FAILURE_BACKOFF_MILLISECONDS,
      maximumBackoffMilliseconds: MAXIMUM_BACKOFF_MILLISECONDS,
      maximumRetryAttempts: MAXIMUM_RETRY_ATTEMPTS,
    },
  },
  mayApprove: false,
  mayPromote: false,
});
