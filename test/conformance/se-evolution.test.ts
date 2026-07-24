import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  assertDatasetSplitAccess,
  makeEvolutionAgentOperations,
  transitionEvolutionRun,
  validateCandidateLineage,
  validateCodeCandidate,
  validateMutationPaths,
} from "../../src/learning/evolution/index";
import {
  DatasetReadyRunState,
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionTarget,
} from "../../src/learning/evolution/model/index";
import {
  makeCandidate,
  makeRun,
  makeTarget,
  transitionContext,
} from "../unit/evolution/helpers";

const codeSurface = (capabilities: readonly string[]) => ({
  publicSignatures: ["export function run(): void"],
  manifestDigest: "sha256:manifest",
  protocolSchemaDigests: ["sha256:protocol"],
  capabilities,
  egressDestinations: [],
  isolation: "container",
  securityCheckMarkers: ["assertAuthority"],
  evaluatorFixtureDigests: ["sha256:fixture"],
});

describe("SE evolution conformance", () => {
  it("SE1 rejects a target digest change before the next run state", async () => {
    await expect(Effect.runPromise(transitionEvolutionRun(
      makeRun(),
      DatasetReadyRunState.make({
        datasetId: "evd_12345678",
        datasetDigest: "sha256:dataset",
      }),
      {
        ...transitionContext(),
        activeTargetDigest: "sha256:changed",
      },
    ))).rejects.toHaveProperty("_tag", "EvolutionStaleTargetError");
  });

  it("SE3 keeps optimizer, evaluator, author, and deployment roles separate", async () => {
    await expect(
      Effect.runPromise(
        assertDatasetSplitAccess("EvolutionOptimizer", "holdout"),
      ),
    ).rejects.toHaveProperty("_tag", "EvolutionAuthorityError");
  });

  it("SE4 contains candidate writes and rejects active paths", () => {
    const results = validateMutationPaths({
      target: makeTarget(),
      changedPaths: ["/active/component.yaml"],
    });
    expect(results.every((result) => result.passed)).toBe(false);
  });

  it("SE5 grants hidden holdout only to the independent evaluator", async () => {
    await Effect.runPromise(
      assertDatasetSplitAccess("EvolutionEvaluator", "holdout"),
    );
  });

  it("SE4 rejects cyclic or cross-run candidate lineage", async () => {
    const firstId = EvolutionCandidateIdSchema.make("evc_first000");
    const secondId = EvolutionCandidateIdSchema.make("evc_second00");
    const base = makeCandidate();
    const first = EvolutionCandidate.make({
      ...base,
      id: firstId,
      parentCandidateId: secondId,
    });
    const second = EvolutionCandidate.make({
      ...base,
      id: secondId,
      parentCandidateId: firstId,
    });
    await expect(
      Effect.runPromise(validateCandidateLineage([first, second])),
    ).rejects.toHaveProperty("_tag", "EvolutionConstraintError");
  });

  it("SE12 exposes no model-facing approval, promotion, or rollback", () => {
    const operations = makeEvolutionAgentOperations({
      inspectTarget: async () => ({}),
      requestRun: async () => ({}),
      getStatus: async () => ({}),
      requestProposal: async () => ({}),
    });
    expect(operations.mayApprove).toBe(false);
    expect(operations.mayPromote).toBe(false);
    expect(operations.mayRollback).toBe(false);
    expect(operations.tools.map((tool) => tool.name)).toEqual([
      "evolution_inspect_target",
      "evolution_request_run",
      "evolution_get_status",
      "evolution_request_proposal",
    ]);
  });

  it("SE13 rejects code changes to frozen authority surfaces", () => {
    const result = validateCodeCandidate({
      target: EvolutionTarget.make({
        ...makeTarget(),
        targetClass: "code",
      }),
      changedPaths: ["/workspace/SKILL.md"],
      patch: "+safe helper",
      scheduled: false,
      focusedTestPassed: true,
      fullCheckPassed: true,
      baselineSurface: codeSurface(["files.read"]),
      candidateSurface: codeSurface(["files.read", "network.fetch"]),
      baselineErrorPathCoverage: 1,
      candidateErrorPathCoverage: 1,
    });
    expect(result.passed).toBe(false);
    expect(
      result.results.find(
        (item) => item.constraint === "code-frozen-surface",
      )?.passed,
    ).toBe(false);
  });
});
