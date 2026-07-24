import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { componentRef, digest } from "../../../src/core/brands";
import {
  makeEvolutionScheduledCampaign,
  parseEvolutionCliRequest,
  promptBehaviorDatasetCases,
  toolSelectionDatasetCases,
  triageEvolutionSignals,
  validateCodeCandidate,
  validateEngineIsolation,
  validateInitialDatasetVolume,
  validatePromptCandidate,
  validateSkillCandidate,
  validateToolDescriptionCandidate,
} from "../../../src/learning/evolution/index";
import { EvolutionSignal } from "../../../src/learning/evolution/model/index";
import type { PromptSegment } from "../../../src/prompt/types";
import { makeTarget } from "./helpers";

const prompt = (content: string): PromptSegment => ({
  id: "interaction-profile:default",
  purpose: "interaction-profile",
  source: "profile/default",
  digest: digest(`sha256:${content}`),
  trust: "authenticated",
  securityTags: [],
  classification: "internal",
  content,
  evolution: {
    id: "interaction-profile:default",
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

describe("evolution target and continuous controls", () => {
  it("builds policy-sized prompt and tool campaign datasets", async () => {
    const promptCases = promptBehaviorDatasetCases("sha256:prompt");
    expect(promptCases).toHaveLength(60);
    await Effect.runPromise(
      validateInitialDatasetVolume("prompt-segment", promptCases),
    );

    const entries = Array.from({ length: 18 }, (_, toolIndex) => ({
      toolRef: `core/tool/tool-${toolIndex}`,
      description: `Tool ${toolIndex}`,
      parameterNames: ["value"],
      positiveTasks: Array.from(
        { length: 10 },
        (_, caseIndex) => `Use tool ${toolIndex} for case ${caseIndex}`,
      ),
    }));
    const toolCases = toolSelectionDatasetCases(entries);
    expect(toolCases).toHaveLength(200);
    await Effect.runPromise(
      validateInitialDatasetVolume("tool-description", toolCases),
    );
  });

  it("preserves skill, tool, prompt, and code frozen surfaces", () => {
    const skill = validateSkillCandidate({
      target: makeTarget(),
      namespace: "workspace",
      baselineMarkdown: "---\nname: review\nallowed-tools: files\n---\nReview.",
      candidateMarkdown:
        "---\nname: review\nallowed-tools: files\n---\nReview carefully.",
      maximumCharacters: 100,
    });
    expect(skill.passed).toBe(true);

    const tool = validateToolDescriptionCandidate({
      target: { ...makeTarget(), targetClass: "tool-description" },
      baselineDescriptions: { tool: "old", parameter: "path" },
      candidateDescriptions: { tool: "clearer", parameter: "file path" },
      baselineSchema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
      candidateSchema: {
        properties: { path: { type: "string" } },
        type: "object",
      },
      topLevelDescriptionKey: "tool",
      maximumTopLevelCharacters: 500,
      maximumParameterCharacters: 200,
    });
    expect(tool.passed).toBe(true);

    expect(
      validatePromptCandidate({
        target: { ...makeTarget(), targetClass: "prompt-segment" },
        baseline: prompt("Be concise."),
        candidate: prompt("Be concise and concrete."),
        baselineTokenCount: 10,
        candidateTokenCount: 12,
      }).passed,
    ).toBe(true);

    expect(
      validateCodeCandidate({
        target: { ...makeTarget(), targetClass: "code" },
        changedPaths: ["/workspace/component.yaml"],
        patch: "+safe",
        scheduled: true,
        focusedTestPassed: true,
        fullCheckPassed: true,
        baselineSurface: codeSurface(),
        candidateSurface: codeSurface(),
        baselineErrorPathCoverage: 1,
        candidateErrorPathCoverage: 1,
      }).passed,
    ).toBe(false);
  });

  it("requires digest-pinned candidate-only engine isolation", async () => {
    await Effect.runPromise(validateEngineIsolation({
      engineRef: "organization/evaluator/dspy",
      isolation: "container",
      image: `engine@sha256:${"a".repeat(64)}`,
      hasRepositoryCredentials: false,
      hasActiveTreeWrite: false,
      hasContainerRuntimeSocket: false,
      holdoutReadable: false,
    }));
    await expect(Effect.runPromise(validateEngineIsolation({
      engineRef: "organization/evaluator/dspy",
      isolation: "container",
      image: "engine:latest",
      hasRepositoryCredentials: false,
      hasActiveTreeWrite: false,
      hasContainerRuntimeSocket: false,
      holdoutReadable: true,
    }))).rejects.toHaveProperty("_tag", "EvolutionEngineError");
  });

  it("ranks eligible signals and schedules no deployment authority", () => {
    const low = EvolutionSignal.make({
      id: "low",
      targetRef: "workspace/skill/low",
      targetClass: "skill",
      riskClass: "C1",
      strength: 1,
      usageFrequency: 1,
      expectedImpact: 1,
      evaluatorConfidence: 1,
      estimatedCost: 10,
      source: "benchmark",
      createdAt: new Date(0).toISOString(),
    });
    const high = EvolutionSignal.make({
      ...low,
      id: "high",
      targetRef: "workspace/skill/high",
      expectedImpact: 10,
    });
    const triage = triageEvolutionSignals({
      signals: [low, high],
      cooldownTargetRefs: new Set(),
      activeTargetRefs: new Set(),
      activeRunCount: 0,
      maximumConcurrentRuns: 1,
      monthlySpentUsd: 0,
      monthlyBudgetUsd: 100,
      maximumRiskClass: "C2",
    });
    expect(triage.selected?.id).toBe("high");

    const campaign = makeEvolutionScheduledCampaign({
      jobId: "job",
      principalId: "EvolutionProposalAuthor",
      agentRef: componentRef("core/agent/evolution"),
      targetRef: high.targetRef,
      targetDigest: "sha256:target",
      engineRef: "organization/evaluator/dspy-gepa",
      runAt: new Date(0).toISOString(),
    });
    expect(campaign.mayApprove).toBe(false);
    expect(campaign.mayPromote).toBe(false);
    expect(campaign.job.requestedCapabilities.map((item) => item.capability))
      .not.toContain("release.promote");
  });

  it("parses every operator command family without a deploy shortcut", () => {
    expect(parseEvolutionCliRequest(["evolve", "status", "evr_12345678"]))
      .toEqual({
        operation: "evolution.status",
        arguments: ["evr_12345678"],
      });
    expect(parseEvolutionCliRequest(["evolve", "resume", "evr_12345678"]))
      .toEqual({
        operation: "evolution.resume",
        arguments: ["evr_12345678"],
      });
    expect(parseEvolutionCliRequest(["release", "rollback", "evl_12345678"]))
      .toEqual({
        operation: "release.rollback",
        arguments: ["evl_12345678"],
      });
    expect(() => parseEvolutionCliRequest(["evolve", "deploy", "target"]))
      .toThrow();
  });
});
