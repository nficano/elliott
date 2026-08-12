import * as Effect from "effect/Effect";
import { triageEvolutionSignals } from "./triage";
import type {
  EvolutionContinuousControllerShape,
  EvolutionContinuousStageHandlers,
  EvolutionContinuousWorkflowShape,
  EvolutionNotificationSink,
} from "./types";

const notify = (
  sink: EvolutionNotificationSink,
  event: Parameters<EvolutionNotificationSink["notify"]>[0],
  references: Readonly<Record<string, string>>,
) =>
  Effect.tryPromise(() => sink.notify(event, references)).pipe(Effect.ignore);

export const makeEvolutionContinuousWorkflow = (
  handlers: EvolutionContinuousStageHandlers,
  notifications: EvolutionNotificationSink,
): EvolutionContinuousWorkflowShape => ({
  run: Effect.fn("runContinuousEvolutionCycle")(function*(signal) {
    const detected = yield* handlers.detect(signal);
    const dataset = yield* handlers.buildDataset(detected);
    const optimized = yield* handlers.optimize(dataset);
    const evaluated = yield* handlers.evaluate(optimized);
    const proposal = yield* handlers.authorProposal(evaluated);
    yield* notify(notifications, "run-completed", {
      runId: proposal.runId,
      candidateId: proposal.candidateId,
      reportId: proposal.reportId,
    });
    yield* notify(notifications, "proposal-ready", {
      runId: proposal.runId,
      proposalId: proposal.proposalId,
    });
    return proposal;
  }),
  mayApprove: false,
  mayPromote: false,
});

export const makeEvolutionContinuousController = (
  workflow: EvolutionContinuousWorkflowShape,
): EvolutionContinuousControllerShape => ({
  cycle: Effect.fn("triageAndRunContinuousEvolution")(function*(input) {
    const triage = triageEvolutionSignals(input);
    if (triage.selected === undefined) return { triage };
    const result = yield* workflow.run(triage.selected);
    return { triage, result };
  }),
  mayApprove: false,
  mayPromote: false,
});
