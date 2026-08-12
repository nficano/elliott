import {
  EvolutionDatasetSource,
  EvolutionUnsplitDatasetCase,
} from "../../model/index";
import type {
  EvolutionDatasetSourceResult,
  EvolutionSessionSourceInput,
  EvolutionSessionStoreSourceInput,
} from "./types";

const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;

export const sessionDerivedDatasetSource = (
  input: EvolutionSessionSourceInput,
): EvolutionDatasetSourceResult => {
  const relevant = input.feedback.filter(
    (feedback) => feedback.targetRef === input.targetRef,
  );
  const cases = relevant.map((feedback) => {
    const toolCall = input.toolCalls.find((call) =>
      call.runId === feedback.runId
    );
    return EvolutionUnsplitDatasetCase.make({
      id: `session-${feedback.id}`,
      groupId: `run-${feedback.runId}`,
      input: {
        runId: feedback.runId,
        evidenceDigest: feedback.evidenceDigest,
        requestedTool: toolCall?.requestedTool ?? null,
        selectedTool: toolCall?.selectedTool ?? null,
        argumentsDigest: toolCall?.argumentsDigest ?? null,
      },
      expected: {
        disposition: feedback.kind,
        evidenceDigest: feedback.evidenceDigest,
      },
      rubric:
        "Reproduce the confirmed outcome without exposing source content.",
      classification: input.classification,
      sourceDigests: [input.sourceDigest, feedback.evidenceDigest],
      timeoutMilliseconds: DEFAULT_TIMEOUT_MILLISECONDS,
      maximumCostUsd: 0,
      allowedEffects: [],
    });
  });
  return {
    source: EvolutionDatasetSource.make({
      kind: "session",
      reference: input.targetRef,
      digest: input.sourceDigest,
      classification: input.classification,
      consentOrLicense: "policy-governed-session-evidence",
    }),
    cases,
  };
};

export const sessionDerivedDatasetSourceFromStore = (
  input: EvolutionSessionStoreSourceInput,
): EvolutionDatasetSourceResult => {
  const feedback = input.store.feedbackForTarget(input.targetRef);
  const toolCalls = feedback.flatMap((item) =>
    input.store.toolCallsForRun(item.runId)
  );
  return sessionDerivedDatasetSource({
    targetRef: input.targetRef,
    classification: input.classification,
    sourceDigest: input.sourceDigest,
    feedback,
    toolCalls,
  });
};
