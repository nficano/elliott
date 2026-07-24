/* eslint-disable max-lines, max-lines-per-function, complexity, better-max-params/better-max-params */
import * as Effect from "effect/Effect";
import { principalId } from "../../../core/brands";
import { requiredEvolutionReviewCount } from "../../proposals/evolution-codec";
import { proposalApprovers } from "../../proposals/reviews";
import type { Proposal } from "../../types";
import { REPEATED_FAILURE_RANK } from "../../types";
import type {
  EvolutionCliRequest,
  EvolutionControlAuthority,
  EvolutionControlPlaneExecutor,
} from "../cli/types";
import { evolutionTargetAllowed } from "../config";
import { projectEvolutionPerformance } from "../continuous/projections";
import {
  EvolutionBudgets,
  EvolutionCandidateIdSchema,
  EvolutionDatasetIdSchema,
  EvolutionRunIdSchema,
} from "../model/index";
import type { EvolutionRun, EvolutionTarget } from "../model/index";
import { recordEvolutionProposalMetric } from "../observability/index";
import {
  boundedPositiveIntegerOption,
  boundedPositiveNumberOption,
  firstOption,
  integerOption,
  parseEvolutionArguments,
} from "./arguments";
import type {
  EvolutionOperatorApplicationInput,
  EvolutionParsedArguments,
  EvolutionRunResult,
} from "./types";

const DEFAULT_CONCURRENCY = 1;
const MILLISECONDS_PER_MINUTE = 60_000;

const runPromise = <Value, Error>(
  effect: Effect.Effect<Value, Error>,
): Promise<Value> => Effect.runPromise(effect);

const requiredPositional = (
  parsed: EvolutionParsedArguments,
  index: number,
  label: string,
): string => {
  const value = parsed.positionals[index];
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return value;
};

const engineFor = (
  input: EvolutionOperatorApplicationInput,
  target: EvolutionTarget,
  parsed: EvolutionParsedArguments,
): { readonly ref: string; readonly kind: EvolutionRun["engineKind"]; } => {
  const selected = firstOption(parsed, "engine");
  if (target.targetClass === "code") {
    const ref = selected ?? input.config.engines.code.primary;
    return { ref, kind: "darwinian" };
  }
  const primary = input.config.engines.text.primary;
  const fallback = input.config.engines.text.fallback;
  const ref = selected ?? primary;
  return {
    ref,
    kind: fallback !== undefined && ref === fallback ? "miprov2" : "gepa",
  };
};

const budgetsFor = (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) => {
  const configured = input.config.budgets.perRun;
  return EvolutionBudgets.make({
    maximumCandidates: boundedPositiveIntegerOption(
      parsed,
      "maximum-candidates",
      configured.candidates,
    ),
    maximumTokens: boundedPositiveIntegerOption(
      parsed,
      "maximum-tokens",
      configured.tokens,
    ),
    maximumCostUsd: boundedPositiveNumberOption(
      parsed,
      "maximum-cost-usd",
      configured.costUsd,
    ),
    maximumDurationMilliseconds: boundedPositiveIntegerOption(
      parsed,
      "maximum-duration-minutes",
      configured.durationMinutes,
    ) * MILLISECONDS_PER_MINUTE,
    maximumConcurrency: boundedPositiveIntegerOption(
      parsed,
      "maximum-concurrency",
      DEFAULT_CONCURRENCY,
    ),
  });
};

const summarizeRun = async (
  input: EvolutionOperatorApplicationInput,
  runId: string,
): Promise<EvolutionRunResult> => {
  const id = EvolutionRunIdSchema.make(runId);
  const [run, candidates] = await Promise.all([
    runPromise(input.runs.get(id)),
    runPromise(input.candidates.listForRun(id)),
  ]);
  return {
    runId: run.id,
    state: run.state._tag,
    candidateIds: candidates.map((candidate) => candidate.id),
  };
};

// Decision records need all four values at the authority boundary.

const persistProposalDecision = async (
  input: EvolutionOperatorApplicationInput,
  proposal: Proposal,
  decision?: "approved" | "rejected",
): Promise<void> => {
  await input.proposalStore.update(proposal);
  if (decision === undefined) return;
  await runPromise(recordEvolutionProposalMetric(
    proposal.evolution?.targetClass ?? "unknown",
    decision,
  ));
};

const decideProposal = async (
  input: EvolutionOperatorApplicationInput,
  authority: EvolutionControlAuthority,
  proposalId: string,
  status: "approved" | "rejected",
): Promise<Proposal> => {
  const proposal = input.proposalStore.get(proposalId);
  if (proposal === undefined) throw new TypeError("Unknown Proposal");
  if (
    proposal.status !== "authored"
    && proposal.status !== "evaluated"
    && proposal.status !== "awaiting-review"
  ) {
    throw new TypeError("Proposal is not awaiting a decision");
  }
  const reviewer = principalId(authority.principalId);
  if (status === "approved" && proposal.author === reviewer) {
    throw new TypeError("Proposal author cannot approve their own Proposal");
  }
  if (status === "rejected") {
    const rejected = Object.freeze({
      ...proposal,
      status,
      approver: reviewer,
    }) satisfies Proposal;
    await persistProposalDecision(input, rejected, "rejected");
    return rejected;
  }
  const currentApprovers = proposalApprovers(proposal);
  if (currentApprovers.includes(reviewer)) {
    throw new TypeError("Proposal reviewer already recorded a decision");
  }
  const approvers = Object.freeze([...currentApprovers, reviewer]);
  const approved = approvers.length >= requiredEvolutionReviewCount(
    proposal.evolution,
  );
  const updated = Object.freeze({
    ...proposal,
    status: approved ? "approved" : "awaiting-review",
    approver: reviewer,
    approvers,
  }) satisfies Proposal;
  await persistProposalDecision(
    input,
    updated,
    approved ? "approved" : undefined,
  );
  return updated;
};

const inspect = async (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) => {
  const targetRef = requiredPositional(parsed, 0, "target");
  if (!evolutionTargetAllowed(input.config, targetRef)) {
    throw new TypeError("Target is outside the evolution allowlist");
  }
  return runPromise(input.targets.resolve(targetRef)).then((value) =>
    value.target
  );
};

const buildDataset = async (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) => {
  const materialized = await runPromise(
    input.targets.resolve(requiredPositional(parsed, 0, "target")),
  );
  if (!evolutionTargetAllowed(input.config, materialized.target.componentRef)) {
    throw new TypeError("Target is outside the evolution allowlist");
  }
  const sources = parsed.options["source"] ?? [];
  const dataset = await runPromise(
    input.datasetFactory.build(
      materialized.target,
      sources,
      integerOption(parsed, "seed", input.randomSeed?.() ?? 0),
    ),
  );
  await runPromise(input.datasets.save(dataset));
  return dataset;
};

const startRun = async (
  input: EvolutionOperatorApplicationInput,
  authority: EvolutionControlAuthority,
  parsed: EvolutionParsedArguments,
) => {
  const targetRef = requiredPositional(parsed, 0, "target");
  if (!evolutionTargetAllowed(input.config, targetRef)) {
    throw new TypeError("Target is outside the evolution allowlist");
  }
  const materialized = await runPromise(input.targets.resolve(targetRef));
  const engine = engineFor(input, materialized.target, parsed);
  const now = input.now?.() ?? new Date().toISOString();
  const seed = integerOption(parsed, "seed", input.randomSeed?.() ?? 0);
  const run = await runPromise(input.orchestrator.scope({
    principalId: authority.principalId,
    baselineSnapshotId: authority.snapshotId,
    engineRef: engine.ref,
    engineKind: engine.kind,
    configurationDigest: input.configurationDigest,
    target: materialized.target,
    budgets: budgetsFor(input, parsed),
    signalIds: parsed.options["signal"] ?? [],
    now,
  }));
  const requestedDataset = firstOption(parsed, "dataset");
  const dataset = requestedDataset === undefined
    ? await runPromise(
      input.datasetFactory.build(
        materialized.target,
        parsed.options["source"] ?? [],
        seed,
      ),
    )
    : await runPromise(
      input.datasets.get(
        EvolutionDatasetIdSchema.make(requestedDataset),
      ),
    );
  const datasetReady = await runPromise(
    input.orchestrator.attachDataset(run.id, dataset, now),
  );
  await runPromise(input.baselineController.measure({
    run: datasetReady,
    dataset,
    baselineContent: materialized.baselineContent,
    seed,
  }));
  const candidates = await runPromise(input.orchestrator.optimize({
    runId: run.id,
    baselineContent: materialized.baselineContent,
    seed,
    now,
    ...(materialized.codeSandbox !== undefined && {
      codeSandbox: materialized.codeSandbox,
    }),
  }));
  const current = await runPromise(input.runs.get(run.id));
  return {
    runId: current.id,
    state: current.state._tag,
    candidateIds: candidates.map((candidate) => candidate.id),
  } satisfies EvolutionRunResult;
};

const compare = async (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) => {
  const runId = requiredPositional(parsed, 0, "run");
  const run = await runPromise(
    input.runs.get(EvolutionRunIdSchema.make(runId)),
  );
  if (run.state._tag !== "shortlisted") {
    throw new TypeError("Run has no sealed shortlist");
  }
  const candidateId = firstOption(parsed, "candidate")
    ?? run.state.candidateIds[0];
  if (candidateId === undefined) throw new TypeError("Candidate is required");
  if (run.datasetId === undefined) {
    throw new TypeError("Run has no sealed evaluation dataset");
  }
  const [candidate, dataset] = await Promise.all([
    runPromise(input.candidates.get(
      EvolutionCandidateIdSchema.make(candidateId),
    )),
    runPromise(input.datasets.get(run.datasetId)),
  ]);
  const request = await runPromise(
    input.evaluationRequestFactory.build(run, candidate, dataset),
  );
  const report = await runPromise(input.evaluator.compare(request));
  const recorded = await runPromise(input.orchestrator.recordEvaluation(
    report,
  ));
  input.projections?.put(projectEvolutionPerformance(run, recorded));
  return recorded;
};

const pause = async (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) =>
  runPromise(input.orchestrator.pause(
    EvolutionRunIdSchema.make(requiredPositional(parsed, 0, "run")),
    input.now?.() ?? new Date().toISOString(),
  ));

const resume = async (
  input: EvolutionOperatorApplicationInput,
  parsed: EvolutionParsedArguments,
) => {
  const runId = EvolutionRunIdSchema.make(
    requiredPositional(parsed, 0, "run"),
  );
  const run = await runPromise(input.runs.get(runId));
  if (run.optimizationSeed === undefined) {
    throw new TypeError("Run has no recorded optimization seed");
  }
  const materialized = await runPromise(
    input.targets.resolve(run.target.componentRef),
  );
  if (materialized.target.baselineDigest !== run.target.baselineDigest) {
    throw new TypeError("Target changed before optimization resume");
  }
  await runPromise(input.orchestrator.resume({
    runId,
    baselineContent: materialized.baselineContent,
    seed: run.optimizationSeed,
    now: input.now?.() ?? new Date().toISOString(),
    ...(materialized.codeSandbox !== undefined && {
      codeSandbox: materialized.codeSandbox,
    }),
  }));
  return summarizeRun(input, runId);
};

const propose = async (
  input: EvolutionOperatorApplicationInput,
  authority: EvolutionControlAuthority,
  parsed: EvolutionParsedArguments,
) => {
  const runId = EvolutionRunIdSchema.make(
    requiredPositional(parsed, 0, "run"),
  );
  const run = await runPromise(input.runs.get(runId));
  if (run.state._tag !== "evaluated" || !run.state.passed) {
    throw new TypeError("Run does not have a passing evaluation");
  }
  const candidateId = firstOption(parsed, "candidate");
  if (candidateId === undefined) throw new TypeError("--candidate is required");
  const [candidate, report, activeTargetDigest] = await Promise.all([
    runPromise(
      input.candidates.get(
        EvolutionCandidateIdSchema.make(candidateId),
      ),
    ),
    runPromise(input.reports.get(run.state.reportId)),
    runPromise(input.targets.activeDigest(run.target.componentRef)),
  ]);
  return runPromise(input.orchestrator.propose({
    runId,
    candidateId: candidate.id,
    reportId: report.id,
    authorId: authority.principalId,
    activeTargetDigest,
    signals: run.signalIds.map((id) => ({
      id,
      rank: REPEATED_FAILURE_RANK,
      source: "evolution-signal",
      evidence: id,
      createdAt: run.createdAt,
    })),
    requiredConstraints: parsed.options["constraint"] ?? [],
    proposalStore: input.proposalStore,
    now: input.now?.() ?? new Date().toISOString(),
  }));
};

// The exhaustive switch is the auditable mapping from every public command to
// exactly one application operation.

export const makeEvolutionOperatorExecutor = (
  input: EvolutionOperatorApplicationInput,
): EvolutionControlPlaneExecutor => ({
  execute: async (authority, request: EvolutionCliRequest) => {
    const parsed = parseEvolutionArguments(request.arguments);
    switch (request.operation) {
      case "evolution.inspect": {
        return inspect(input, parsed);
      }
      case "evolution.dataset.build": {
        return buildDataset(input, parsed);
      }
      case "evolution.run": {
        return startRun(input, authority, parsed);
      }
      case "evolution.status": {
        return summarizeRun(
          input,
          requiredPositional(parsed, 0, "run"),
        );
      }
      case "evolution.pause": {
        return pause(input, parsed);
      }
      case "evolution.resume": {
        return resume(input, parsed);
      }
      case "evolution.cancel": {
        return runPromise(input.orchestrator.cancel(
          EvolutionRunIdSchema.make(requiredPositional(parsed, 0, "run")),
          input.now?.() ?? new Date().toISOString(),
          firstOption(parsed, "reason") ?? "operator cancellation",
        ));
      }
      case "evolution.compare": {
        return compare(input, parsed);
      }
      case "evolution.propose": {
        return propose(input, authority, parsed);
      }
      case "proposal.review": {
        const proposal = input.proposalStore.get(
          requiredPositional(parsed, 0, "Proposal"),
        );
        if (proposal === undefined) throw new TypeError("Unknown Proposal");
        return proposal;
      }
      case "proposal.approve": {
        return decideProposal(
          input,
          authority,
          requiredPositional(parsed, 0, "Proposal"),
          "approved",
        );
      }
      case "proposal.reject": {
        return decideProposal(
          input,
          authority,
          requiredPositional(parsed, 0, "Proposal"),
          "rejected",
        );
      }
      case "release.promote": {
        return runPromise(input.releaseController.promote(
          requiredPositional(parsed, 0, "Proposal"),
          authority,
        ));
      }
      case "release.rollback": {
        return runPromise(input.releaseController.rollback(
          requiredPositional(parsed, 0, "release"),
          authority,
        ));
      }
    }
  },
});

export * from "./arguments";
export type * from "./types";
export * from "./validation";
