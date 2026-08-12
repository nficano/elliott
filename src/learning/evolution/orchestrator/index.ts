import * as Effect from "effect/Effect";
import {
  AwaitingReviewRunState,
  DetectedRunState,
  EvolutionRun,
  EvolutionRunIdSchema,
  ProposalAuthoredRunState,
  ScopedRunState,
} from "../model/index";
import {
  recordEvolutionProposalMetric,
  recordEvolutionRunMetric,
} from "../observability/index";
import { authorEvolutionProposal } from "../release/proposal";
import { transitionEvolutionRun } from "../state";
import {
  attachEvolutionDataset,
  cancelEvolutionRun,
  evaluateEvolutionRun,
  pauseEvolutionRun,
  recordEvolutionReport,
  resumeEvolutionRun,
} from "./operations";
import { optimizeEvolutionRun } from "./optimization";
import { appendEvolutionRecord, evolutionTransitionContext } from "./support";
import type {
  EvolutionOrchestratorDependencies,
  EvolutionOrchestratorShape,
  EvolutionProposalInput,
  EvolutionScopeInput,
} from "./types";

const scopeRun = Effect.fn("scopeEvolutionRun")(function*(
  input: EvolutionScopeInput,
  dependencies: EvolutionOrchestratorDependencies,
) {
  const detected = EvolutionRun.make({
    id: EvolutionRunIdSchema.make(`evr_${crypto.randomUUID()}`),
    principalId: input.principalId,
    baselineSnapshotId: input.baselineSnapshotId,
    engineRef: input.engineRef,
    engineKind: input.engineKind,
    configurationDigest: input.configurationDigest,
    signalIds: input.signalIds,
    target: input.target,
    budgets: input.budgets,
    state: DetectedRunState.make({ signalIds: input.signalIds }),
    createdAt: input.now,
    updatedAt: input.now,
  });
  yield* dependencies.runs.save(detected);
  const scoped = yield* transitionEvolutionRun(
    detected,
    ScopedRunState.make({ scopedAt: input.now }),
    evolutionTransitionContext(detected, input.now),
  );
  const stored = yield* dependencies.runs.save(scoped);
  yield* appendEvolutionRecord(dependencies, {
    run: stored,
    type: "evolution.run.scoped",
    payload: {
      targetRef: stored.target.componentRef,
      targetDigest: stored.target.baselineDigest,
      snapshotId: stored.baselineSnapshotId,
    },
  });
  yield* recordEvolutionRunMetric(stored.target.targetClass, "scoped");
  return stored;
});

const proposeRun = Effect.fn("authorEvolutionProposalFromRun")(function*(
  input: EvolutionProposalInput,
  dependencies: EvolutionOrchestratorDependencies,
) {
  const run = yield* dependencies.runs.get(input.runId);
  const candidate = yield* dependencies.candidates.get(input.candidateId);
  const report = yield* dependencies.reports.get(input.reportId);
  const proposal = yield* authorEvolutionProposal({
    run,
    candidate,
    report,
    signals: input.signals,
    requiredConstraints: input.requiredConstraints,
    authorId: input.authorId,
    activeTargetDigest: input.activeTargetDigest,
    store: input.proposalStore,
  });
  const authored = yield* transitionEvolutionRun(
    run,
    ProposalAuthoredRunState.make({
      proposalId: proposal.id,
      candidateId: candidate.id,
    }),
    evolutionTransitionContext(run, input.now),
  );
  const awaiting = yield* transitionEvolutionRun(
    authored,
    AwaitingReviewRunState.make({ proposalId: proposal.id }),
    evolutionTransitionContext(authored, input.now),
  );
  yield* dependencies.runs.save(awaiting);
  yield* appendEvolutionRecord(dependencies, {
    run: awaiting,
    type: "evolution.proposal.authored",
    payload: {
      proposalId: proposal.id,
      candidateId: candidate.id,
      reportId: report.id,
    },
  });
  yield* recordEvolutionProposalMetric(
    awaiting.target.targetClass,
    "authored",
  );
  return proposal;
});

export const makeEvolutionOrchestrator = (
  dependencies: EvolutionOrchestratorDependencies,
): EvolutionOrchestratorShape => ({
  scope: (input) => scopeRun(input, dependencies),
  attachDataset: attachEvolutionDataset(dependencies),
  optimize: (input) => optimizeEvolutionRun(input, dependencies),
  pause: pauseEvolutionRun(dependencies),
  resume: resumeEvolutionRun(dependencies),
  evaluate: evaluateEvolutionRun(dependencies),
  recordEvaluation: recordEvolutionReport(dependencies),
  propose: (input) => proposeRun(input, dependencies),
  cancel: cancelEvolutionRun(dependencies),
});

export type * from "./types";
