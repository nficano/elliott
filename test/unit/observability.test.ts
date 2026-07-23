import { describe, expect, it } from "bun:test";
import {
  enforceFootprintBudgets,
  FootprintRegressionError,
  FootprintTracker,
} from "../../src/observability/index";

describe("M3 footprint attribution", () => {
  it("attributes prompt, inference, and runtime footprints separately", () => {
    const tracker = new FootprintTracker();
    tracker.recordPrompt({
      stablePrefixTokens: 10,
      skillCatalogTokens: 2,
      activatedSkillTokens: 3,
      toolSchemaTokens: 4,
      evidenceTokens: 5,
    });
    tracker.recordInference({
      activity: "main-turn",
      inputTokens: 10,
      cachedInputTokens: 5,
      outputTokens: 2,
      costUsd: 0.01,
      latencyMs: 20,
    });
    tracker.recordRuntime({
      poolContainerCount: 2,
      poolResidencyMb: 256,
      memoryBySecurityContext: { internal: 128 },
      epochTableBytes: 1024,
      routeTableBytes: 2048,
    });
    const report = tracker.report();
    expect(report.prompt.skillCatalogTokens).toBe(2);
    expect(report.inference[0]?.activity).toBe("main-turn");
    expect(report.runtime.memoryBySecurityContext.internal).toBe(128);
  });

  it("fails the configured regression gate", () => {
    expect(() =>
      enforceFootprintBudgets([{
        metric: "prompt.stablePrefixTokens",
        baseline: 100,
        current: 120,
        maximumRegressionRatio: 0.05,
      }])
    ).toThrow(FootprintRegressionError);
  });
});
