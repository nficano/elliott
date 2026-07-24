import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";
import {
  makeEvolutionEvaluationPlanDigest,
} from "../../../src/learning/evolution/evaluation/bindings";
import {
  EvolutionBenchmarkOperation,
  EvolutionComparisonRequest,
  OptimizationEngineRequest,
} from "../../../src/learning/evolution/model/index";

const fixture = async (name: string): Promise<unknown> =>
  Bun.file(
    new URL(`../../../companions/fixtures/${name}`, import.meta.url),
  ).json();

describe("evolution companion wire fixtures", () => {
  it("keeps the DSPy fixture aligned with OptimizationEngineRequest", async () => {
    const request = Schema.decodeUnknownSync(OptimizationEngineRequest)(
      await fixture("dspy-request.json"),
    );
    expect(request.run.engineKind).toBe("gepa");
    expect(request.dataset.holdoutSealed).toBe(true);
  });

  it("keeps the Darwinian fixture aligned with the code sandbox schema", async () => {
    const request = Schema.decodeUnknownSync(OptimizationEngineRequest)(
      await fixture("darwinian-request.json"),
    );
    expect(request.run.engineKind).toBe("darwinian");
    expect(request.codeSandbox?.networkEnabled).toBe(false);
  });

  it("keeps the benchmark fixture aligned with its Snapshot bindings", async () => {
    const operation = Schema.decodeUnknownSync(EvolutionBenchmarkOperation)(
      await fixture("benchmark-request.json"),
    );
    expect(operation.baselineSnapshotId).toBe("snapshot-baseline");
    expect(operation.candidateSnapshotId).toBe("snapshot-candidate");
  });

  it("keeps the independent evaluator fixture bound to its sealed plan", async () => {
    const request = Schema.decodeUnknownSync(EvolutionComparisonRequest)(
      await fixture("evaluation-request.json"),
    );
    const plan = { ...request } as Record<string, unknown>;
    delete plan["evaluationPlanDigest"];
    expect(request.evaluationPlanDigest).toBe(
      makeEvolutionEvaluationPlanDigest(
        plan as Omit<typeof request, "evaluationPlanDigest">,
      ),
    );
    expect(request.dataset.cases.some((item) => item.split === "holdout"))
      .toBeTrue();
    expect(request.authoringRouteDigest).not.toBe(
      request.evaluationRouteDigest,
    );
  });
});
