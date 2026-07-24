import { hashBytes } from "../../../src/core/digest";
import {
  EvolutionBudgets,
  EvolutionBudgetUsage,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  EvolutionConstraintResult,
  EvolutionRun,
  EvolutionRunIdSchema,
  EvolutionTarget,
  EvolutionTransitionContext,
  ScopedRunState,
} from "../../../src/learning/evolution/model/index";

export const RUN_ID = EvolutionRunIdSchema.make("evr_12345678");
export const CANDIDATE_ID = EvolutionCandidateIdSchema.make("evc_12345678");

export const makeTarget = () =>
  EvolutionTarget.make({
    targetClass: "skill",
    componentRef: "workspace/skill/review",
    baselineDigest: "sha256:baseline",
    riskClass: "C1",
    mutationPath: "/workspace/SKILL.md",
    allowedMutationPaths: ["/workspace/SKILL.md"],
    frozenPaths: ["/workspace/component.yaml"],
  });

export const makeRun = () =>
  EvolutionRun.make({
    id: RUN_ID,
    principalId: "EvolutionProposalAuthor",
    baselineSnapshotId: "snapshot:baseline",
    engineRef: "organization/evaluator/dspy-gepa",
    engineKind: "fixture",
    configurationDigest: "sha256:config",
    signalIds: [],
    target: makeTarget(),
    budgets: EvolutionBudgets.make({
      maximumCandidates: 40,
      maximumTokens: 2_000_000,
      maximumCostUsd: 25,
      maximumDurationMilliseconds: 10_800_000,
      maximumConcurrency: 8,
    }),
    state: ScopedRunState.make({ scopedAt: new Date(0).toISOString() }),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });

export const makeCandidate = () =>
  EvolutionCandidate.make({
    id: CANDIDATE_ID,
    runId: RUN_ID,
    targetDigest: "sha256:baseline",
    candidateDigest: hashBytes("new"),
    patch: "-old\n+new",
    materializedContent: "new",
    engineTraceDigest: "sha256:trace",
    usage: EvolutionCandidateUsage.make({
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.01,
      latencyMilliseconds: 10,
    }),
    constraints: [
      EvolutionConstraintResult.make({
        constraint: "syntax",
        passed: true,
        detail: "valid",
        evidenceDigests: [],
      }),
    ],
    createdAt: new Date(0).toISOString(),
  });

export const transitionContext = () =>
  EvolutionTransitionContext.make({
    principalId: "EvolutionProposalAuthor",
    activeTargetDigest: "sha256:baseline",
    now: new Date(1).toISOString(),
    usage: EvolutionBudgetUsage.make({
      candidates: 0,
      tokens: 0,
      costUsd: 0,
      durationMilliseconds: 0,
      concurrency: 0,
    }),
  });
