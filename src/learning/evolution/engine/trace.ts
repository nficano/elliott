import { createHash } from "node:crypto";
import { EvolutionTrajectory, EvolutionTrajectoryStep } from "../model/index";
import type { EvolutionTraceInput } from "./types";

export const trajectoryFromEvidence = (
  input: EvolutionTraceInput,
): EvolutionTrajectory => {
  const labelsByRun = input.labels.filter((label) =>
    label.runId === input.runId
  );
  const steps = input.toolCalls
    .filter((call) => call.runId === input.runId)
    .map((call, sequence) =>
      EvolutionTrajectoryStep.make({
        sequence,
        operation: "tool-call",
        inputDigest: call.argumentsDigest ?? "sha256:omitted",
        outputDigest: call.resultDigest ?? "sha256:omitted",
        ...(labelsByRun[sequence] !== undefined && {
          score: labelsByRun[sequence].score,
          feedback: labelsByRun[sequence].source,
        }),
        ...(call.selectedTool !== undefined && { toolRef: call.selectedTool }),
        latencyMilliseconds: call.latencyMilliseconds,
        ...(call.errorTag !== undefined && { errorTag: call.errorTag }),
      })
    );
  const digest = `sha256:${
    createHash("sha256")
      .update(JSON.stringify({
        runId: input.runId,
        snapshotId: input.snapshotId,
        routeDigest: input.routeDigest,
        steps,
      }))
      .digest("hex")
  }`;
  return EvolutionTrajectory.make({
    runId: input.runId,
    ...(input.candidateId !== undefined && { candidateId: input.candidateId }),
    snapshotId: input.snapshotId,
    routeDigest: input.routeDigest,
    steps,
    totalCostUsd: input.totalCostUsd,
    digest,
  });
};
