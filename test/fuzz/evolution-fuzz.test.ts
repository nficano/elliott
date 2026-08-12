import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { digest } from "../../src/core/brands";
import {
  splitDatasetCases,
  validateCodeCandidate,
  validateMutationPaths,
  validatePromptCandidate,
  validateToolDescriptionCandidate,
} from "../../src/learning/evolution/index";
import {
  DatasetReadyRunState,
  EvolutionDatasetIdSchema,
  EvolutionTransitionContext,
  EvolutionUnsplitDatasetCase,
} from "../../src/learning/evolution/model/index";
import { transitionEvolutionRun } from "../../src/learning/evolution/state";
import type { PromptSegment } from "../../src/prompt/types";
import {
  makeRun,
  makeTarget,
  transitionContext,
} from "../unit/evolution/helpers";

const CASE_GROUPS = 50;
const CASES_PER_GROUP = 3;
const SPLIT_SEEDS = 20;
const STALE_DIGESTS = 20;

const unsplitCase = (group: number, variant: number) =>
  EvolutionUnsplitDatasetCase.make({
    id: `case-${group}-${variant}`,
    groupId: `group-${group}`,
    input: { group, variant },
    expected: { passed: true },
    classification: "internal",
    sourceDigests: [],
    timeoutMilliseconds: 1000,
    maximumCostUsd: 0,
    allowedEffects: [],
  });

const prompt = (content: string): PromptSegment => ({
  id: "profile",
  purpose: "interaction-profile",
  source: "profile/default",
  digest: digest(`sha256:${content}`),
  trust: "authenticated",
  securityTags: [],
  classification: "internal",
  content,
  evolution: {
    id: "profile",
    targetClass: "prompt-segment",
    evolvable: true,
    authority: "zero",
    maximumTokenRatio: 1.2,
  },
});

const codeSurface = () => ({
  publicSignatures: ["export function run(): void"],
  manifestDigest: "sha256:manifest",
  protocolSchemaDigests: ["sha256:protocol"],
  capabilities: ["files.read"],
  egressDestinations: [],
  isolation: "container",
  securityCheckMarkers: ["assertAuthority"],
  evaluatorFixtureDigests: ["sha256:fixture"],
});

describe("evolution invariant fuzzing", () => {
  it("keeps randomized related case groups in one split", () => {
    const cases = Array.from({ length: CASE_GROUPS }, (_, group) =>
      Array.from(
        { length: CASES_PER_GROUP },
        (_, variant) => unsplitCase(group, variant),
      )).flat();
    for (let seed = 0; seed < SPLIT_SEEDS; seed += 1) {
      const split = splitDatasetCases(cases, seed, {
        train: 0.6,
        validation: 0.2,
        holdout: 0.2,
      });
      const groups = new Map<string, Set<string>>();
      for (const item of split) {
        const values = groups.get(item.groupId) ?? new Set<string>();
        values.add(item.split);
        groups.set(item.groupId, values);
      }
      expect([...groups.values()].every((values) => values.size === 1))
        .toBe(true);
    }
  });

  it("rejects path traversal and frozen-path mutations", () => {
    const target = {
      ...makeTarget(),
      allowedMutationPaths: ["/workspace/src"],
      frozenPaths: ["/workspace/src/security"],
    };
    const accepted = [
      "/workspace/src/index.ts",
      "/workspace/src/nested/helper.ts",
    ];
    const rejected = [
      "/workspace/other.ts",
      "/workspace/src/../../secrets",
      "/workspace/src/security/check.ts",
      "/outside/candidate.ts",
    ];
    expect(
      validateMutationPaths({ target, changedPaths: accepted })
        .every((result) => result.passed),
    ).toBe(true);
    for (const changedPath of rejected) {
      expect(
        validateMutationPaths({ target, changedPaths: [changedPath] })
          .every((result) => result.passed),
      ).toBe(false);
    }
  });

  it("rejects every randomized frozen code-surface mutation", () => {
    const baseline = codeSurface();
    const mutations = [
      { ...baseline, publicSignatures: ["export function root(): void"] },
      { ...baseline, manifestDigest: "sha256:changed" },
      { ...baseline, protocolSchemaDigests: ["sha256:changed"] },
      { ...baseline, capabilities: ["files.write"] },
      { ...baseline, egressDestinations: ["example.com"] },
      { ...baseline, isolation: "process" },
      { ...baseline, securityCheckMarkers: [] },
      { ...baseline, evaluatorFixtureDigests: ["sha256:changed"] },
    ];
    for (const candidateSurface of mutations) {
      expect(
        validateCodeCandidate({
          target: { ...makeTarget(), targetClass: "code" },
          changedPaths: ["/workspace/SKILL.md"],
          patch: "+safe",
          scheduled: false,
          focusedTestPassed: true,
          fullCheckPassed: true,
          baselineSurface: baseline,
          candidateSurface,
          baselineErrorPathCoverage: 1,
          candidateErrorPathCoverage: 1,
        }).passed,
      ).toBe(false);
    }
  });

  it("preserves tool schemas and prompt security metadata", () => {
    const toolInput = {
      target: { ...makeTarget(), targetClass: "tool-description" as const },
      baselineDescriptions: { tool: "old", path: "path" },
      candidateDescriptions: { tool: "new", path: "file path" },
      baselineSchema: {
        type: "object",
        properties: { path: { type: "string", minLength: 1 } },
      },
      topLevelDescriptionKey: "tool",
      maximumTopLevelCharacters: 500,
      maximumParameterCharacters: 200,
    };
    expect(
      validateToolDescriptionCandidate({
        ...toolInput,
        candidateSchema: {
          properties: { path: { minLength: 1, type: "string" } },
          type: "object",
        },
      }).passed,
    ).toBe(true);
    expect(
      validateToolDescriptionCandidate({
        ...toolInput,
        candidateSchema: {
          type: "object",
          properties: { path: { type: "number", minLength: 1 } },
        },
      }).passed,
    ).toBe(false);

    const baseline = prompt("Be concise.");
    const valid = prompt("Be concise and concrete.");
    expect(
      validatePromptCandidate({
        target: { ...makeTarget(), targetClass: "prompt-segment" },
        baseline,
        candidate: valid,
        baselineTokenCount: 10,
        candidateTokenCount: 12,
      }).passed,
    ).toBe(true);
    for (
      const candidate of [
        { ...valid, trust: "system" as const },
        { ...valid, purpose: "runtime" as const },
        { ...valid, classification: "restricted" as const },
        { ...valid, securityTags: ["external"] as const },
      ]
    ) {
      expect(
        validatePromptCandidate({
          target: { ...makeTarget(), targetClass: "prompt-segment" },
          baseline,
          candidate,
          baselineTokenCount: 10,
          candidateTokenCount: 12,
        }).passed,
      ).toBe(false);
    }
  });

  it("rejects arbitrary stale target digests", async () => {
    const next = DatasetReadyRunState.make({
      datasetId: EvolutionDatasetIdSchema.make("evd_12345678"),
      datasetDigest: "sha256:dataset",
    });
    for (let index = 0; index < STALE_DIGESTS; index += 1) {
      await expect(Effect.runPromise(transitionEvolutionRun(
        makeRun(),
        next,
        EvolutionTransitionContext.make({
          ...transitionContext(),
          activeTargetDigest: `sha256:changed-${index}`,
        }),
      ))).rejects.toHaveProperty("_tag", "EvolutionStaleTargetError");
    }
  });
});
