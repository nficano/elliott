import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { digest, principalId } from "../../../src/core/brands";
import {
  makeEvolutionOperatorExecutor,
} from "../../../src/learning/evolution/application/index";
import type {
  EvolutionOperatorApplicationInput,
} from "../../../src/learning/evolution/application/types";
import { EvolutionConfig } from "../../../src/learning/evolution/config";
import {
  DatasetReadyRunState,
  EvaluatedRunState,
  EvolutionComparisonRequest,
  EvolutionDatasetIdSchema,
  EvolutionEvaluationReportIdSchema,
  EvolutionRun,
  EvolutionRunIdSchema,
  ShortlistedRunState,
} from "../../../src/learning/evolution/model/index";
import type { Proposal } from "../../../src/learning/types";
import { CANDIDATE_ID, makeCandidate, makeRun, makeTarget } from "./helpers";

const config = EvolutionConfig.make({
  apiVersion: "elliott/v1",
  engines: {
    text: {
      primary: "organization/evaluator/dspy-gepa",
      fallback: "organization/evaluator/dspy-mipro",
    },
    code: { primary: "organization/evaluator/darwinian" },
  },
  budgets: {
    perRun: {
      candidates: 2,
      tokens: 100,
      costUsd: 1,
      durationMinutes: 1,
    },
    monthly: { costUsd: 10 },
  },
  evaluation: {
    authoringProfile: "author",
    judgingProfile: "judge",
    requireDistinctRoute: true,
    split: { train: 0.6, validation: 0.2, holdout: 0.2 },
  },
  continuous: {
    enabled: false,
    benchmarkCron: "0 3 * * 0",
    maximumRiskClass: "C2",
    maximumConcurrentRuns: 1,
  },
  targets: {
    allow: ["workspace/skill/*", "core/code/*"],
    deny: [],
  },
});

const authority = {
  principalId: "operator",
  snapshotId: "snapshot:1",
  authorize: async () => true,
};

const comparisonRequest = async () =>
  Schema.decodeUnknownSync(EvolutionComparisonRequest)(
    await Bun.file(
      new URL(
        "../../../darwin/evaluators/agent-benchmarks/fixtures/evaluation.json",
        import.meta.url,
      ),
    ).json(),
  );

const authoredProposal = (): Proposal => ({
  id: "prp_authored",
  directory: "/var/prp_authored",
  author: principalId("author"),
  target: {
    ref: "workspace/skill/review",
    digest: digest("sha256:baseline"),
  },
  signals: [],
  artifacts: {
    rationale: "r",
    targetYaml: "t",
    patch: "p",
    evidenceYaml: "e",
    permissionDiffYaml: "d",
    evaluationPlanYaml: "plan",
    support: {},
  },
  status: "authored",
  evolution: {
    runId: "evr_12345678",
    targetClass: "skill",
    riskClass: "C1",
    candidateDigest: "sha256:candidate",
    baselineSnapshotId: "snapshot:baseline",
    candidateSnapshotId: "snapshot:candidate",
    evaluationReportId: "eve_12345678",
    datasetDigest: "sha256:dataset",
  },
});

describe("evolution operator executor ops", () => {
  it("inspects, builds datasets, statuses, pauses, cancels, and reviews", async () => {
    const comparison = await comparisonRequest();
    const run = EvolutionRun.make({
      ...makeRun(),
      id: EvolutionRunIdSchema.make(comparison.run.id),
      target: comparison.run.target,
      datasetId: comparison.dataset.id,
      datasetDigest: comparison.dataset.digest,
      state: DatasetReadyRunState.make({
        datasetId: comparison.dataset.id,
        datasetDigest: comparison.dataset.digest,
      }),
    });
    const proposal = authoredProposal();
    const proposals = new Map<string, Proposal>([[proposal.id, proposal]]);
    const calls: string[] = [];
    const input = {
      config,
      configurationDigest: "sha256:configuration",
      orchestrator: {
        pause: () =>
          Effect.sync(() => {
            calls.push("pause");
            return run;
          }),
        cancel: () =>
          Effect.sync(() => {
            calls.push("cancel");
            return run;
          }),
        scope: () => Effect.succeed(run),
        attachDataset: () => Effect.succeed(run),
        optimize: () => Effect.succeed([makeCandidate()]),
      },
      runs: { get: () => Effect.succeed(run) },
      candidates: { listForRun: () => Effect.succeed([makeCandidate()]) },
      datasets: {
        save: () => Effect.void,
        get: () => Effect.succeed(comparison.dataset),
      },
      reports: {},
      releases: {},
      proposalStore: {
        get: (id: string) => proposals.get(id),
        update: async (next: Proposal) => {
          proposals.set(next.id, next);
        },
      },
      targets: {
        resolve: (ref: string) =>
          Effect.succeed({
            target: { ...comparison.run.target, componentRef: ref },
            baselineContent: "baseline",
          }),
        activeDigest: () => Effect.succeed("sha256:baseline"),
      },
      datasetFactory: {
        build: () => Effect.succeed(comparison.dataset),
      },
      evaluationRequestFactory: {},
      evaluator: {},
      baselineController: {},
      releaseController: {
        promote: () =>
          Effect.sync(() => {
            calls.push("promote");
            return { id: "rel_1" };
          }),
        rollback: () =>
          Effect.sync(() => {
            calls.push("rollback");
            return { id: "rel_1" };
          }),
      },
      now: () => new Date(0).toISOString(),
      randomSeed: () => 7,
    } as unknown as EvolutionOperatorApplicationInput;
    const executor = makeEvolutionOperatorExecutor(input);

    await expect(
      executor.execute(authority, {
        operation: "evolution.inspect",
        arguments: ["core/policy/secret"],
      }),
    ).rejects.toThrow(/allowlist/);

    const inspected = await executor.execute(authority, {
      operation: "evolution.inspect",
      arguments: [comparison.run.target.componentRef],
    });
    expect((inspected as { componentRef: string; }).componentRef).toBe(
      comparison.run.target.componentRef,
    );

    const dataset = await executor.execute(authority, {
      operation: "evolution.dataset.build",
      arguments: [comparison.run.target.componentRef, "--source", "s.yaml"],
    });
    expect((dataset as { id: string; }).id).toBe(comparison.dataset.id);

    const status = await executor.execute(authority, {
      operation: "evolution.status",
      arguments: [run.id],
    });
    expect((status as { runId: string; }).runId).toBe(run.id);

    await executor.execute(authority, {
      operation: "evolution.pause",
      arguments: [run.id],
    });
    await executor.execute(authority, {
      operation: "evolution.cancel",
      arguments: [run.id, "--reason", "stop"],
    });
    expect(calls).toEqual(["pause", "cancel"]);

    const reviewed = await executor.execute(authority, {
      operation: "proposal.review",
      arguments: [proposal.id],
    });
    expect((reviewed as Proposal).id).toBe(proposal.id);

    const rejected = await executor.execute(
      { ...authority, principalId: "reviewer" },
      { operation: "proposal.reject", arguments: [proposal.id] },
    ) as Proposal;
    expect(rejected.status).toBe("rejected");

    proposals.set(proposal.id, authoredProposal());
    const approved = await executor.execute(
      { ...authority, principalId: "reviewer" },
      { operation: "proposal.approve", arguments: [proposal.id] },
    ) as Proposal;
    expect(approved.status).toBe("approved");

    await expect(
      executor.execute(
        { ...authority, principalId: "author" },
        { operation: "proposal.approve", arguments: [proposal.id] },
      ),
    ).rejects.toThrow();

    await executor.execute(authority, {
      operation: "release.promote",
      arguments: [proposal.id],
    });
    await executor.execute(authority, {
      operation: "release.rollback",
      arguments: ["rel_1"],
    });
    expect(calls).toContain("promote");
    expect(calls).toContain("rollback");
  });

  it("compares shortlisted runs and proposes after a passing evaluation", async () => {
    const comparison = await comparisonRequest();
    const shortlisted = EvolutionRun.make({
      ...makeRun(),
      id: EvolutionRunIdSchema.make(comparison.run.id),
      target: comparison.run.target,
      datasetId: comparison.dataset.id,
      optimizationSeed: 3,
      state: ShortlistedRunState.make({
        candidateIds: [CANDIDATE_ID],
        sealedAt: new Date(0).toISOString(),
      }),
    });
    const evaluated = EvolutionRun.make({
      ...shortlisted,
      state: EvaluatedRunState.make({
        reportId: EvolutionEvaluationReportIdSchema.make("eve_12345678"),
        passed: true,
      }),
    });
    let current = shortlisted;
    const report = { id: "eve_12345678", passed: true };
    const input = {
      config,
      configurationDigest: "sha256:configuration",
      orchestrator: {
        recordEvaluation: (value: unknown) => Effect.succeed(value),
        propose: () => Effect.succeed({ id: "prp_new" }),
        resume: () => Effect.succeed(current),
      },
      runs: {
        get: () => Effect.succeed(current),
      },
      candidates: {
        get: () => Effect.succeed(makeCandidate()),
        listForRun: () => Effect.succeed([makeCandidate()]),
      },
      datasets: {
        get: () => Effect.succeed(comparison.dataset),
      },
      reports: {
        get: () => Effect.succeed(report),
      },
      releases: {},
      proposalStore: {},
      targets: {
        resolve: () =>
          Effect.succeed({
            target: comparison.run.target,
            baselineContent: "baseline",
          }),
        activeDigest: () =>
          Effect.succeed(comparison.run.target.baselineDigest),
      },
      datasetFactory: {},
      evaluationRequestFactory: {
        build: () => Effect.succeed(comparison),
      },
      evaluator: {
        compare: () => Effect.succeed(report),
      },
      baselineController: {},
      releaseController: {},
      now: () => new Date(0).toISOString(),
    } as unknown as EvolutionOperatorApplicationInput;
    const executor = makeEvolutionOperatorExecutor(input);

    const compared = await executor.execute(authority, {
      operation: "evolution.compare",
      arguments: [shortlisted.id],
    });
    expect(compared).toEqual(report);

    current = evaluated;
    const proposed = await executor.execute(authority, {
      operation: "evolution.propose",
      arguments: [evaluated.id, "--candidate", CANDIDATE_ID],
    });
    expect(proposed).toEqual({ id: "prp_new" });

    const resumed = await executor.execute(authority, {
      operation: "evolution.resume",
      arguments: [current.id],
    });
    expect((resumed as { runId: string; }).runId).toBe(current.id);
  });

  it("selects darwinian for code targets and miprov2 for text fallback", async () => {
    const comparison = await comparisonRequest();
    const engines: string[] = [];
    const codeTarget = {
      ...makeTarget(),
      targetClass: "code" as const,
      componentRef: "core/code/demo",
    };
    const input = {
      config,
      configurationDigest: "sha256:configuration",
      orchestrator: {
        scope: (request: {
          readonly engineKind: string;
          readonly engineRef: string;
        }) =>
          Effect.sync(() => {
            engines.push(`${request.engineKind}:${request.engineRef}`);
            return makeRun();
          }),
        attachDataset: () => Effect.succeed(makeRun()),
        optimize: () => Effect.succeed([]),
      },
      runs: { get: () => Effect.succeed(makeRun()) },
      candidates: {},
      datasets: {
        get: () => Effect.succeed(comparison.dataset),
        save: () => Effect.void,
      },
      reports: {},
      releases: {},
      proposalStore: {},
      targets: {
        resolve: (ref: string) =>
          Effect.succeed({
            target: ref.startsWith("core/code")
              ? codeTarget
              : comparison.run.target,
            baselineContent: "baseline",
          }),
      },
      datasetFactory: {
        build: () => Effect.succeed(comparison.dataset),
      },
      evaluationRequestFactory: {},
      evaluator: {},
      baselineController: {
        measure: () => Effect.succeed({}),
      },
      releaseController: {},
      now: () => new Date(0).toISOString(),
      randomSeed: () => 1,
    } as unknown as EvolutionOperatorApplicationInput;
    const executor = makeEvolutionOperatorExecutor(input);

    await executor.execute(authority, {
      operation: "evolution.run",
      arguments: ["core/code/demo"],
    });
    await executor.execute(authority, {
      operation: "evolution.run",
      arguments: [
        comparison.run.target.componentRef,
        "--engine",
        "organization/evaluator/dspy-mipro",
        "--dataset",
        EvolutionDatasetIdSchema.make(comparison.dataset.id),
      ],
    });
    expect(engines[0]).toContain("darwinian:");
    expect(engines[1]).toContain("miprov2:");
  });
});
