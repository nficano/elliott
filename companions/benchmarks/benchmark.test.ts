import { beforeEach, describe, expect, test } from "bun:test";
import {
  DatasetReadyRunState,
  EvolutionBaselineRequest,
  EvolutionBenchmarkOperation,
  EvolutionCandidate,
  EvolutionCodeCheckRequest,
  EvolutionComparisonRequest,
  EvolutionRun,
  EvolutionRunIdSchema,
} from "../../src/learning/evolution/model/index";
import { canonicalJson, decodeUnknown, sha256Text } from "../typescript/wire";
import { runBenchmark } from "./benchmark";
import { checkCandidate } from "./code-check";
import { baseline, compare } from "./evaluation";

const EXPECTED_REGRESSION_RATIO = 0.02;
const EXPECTED_CONSTRAINT_COUNT = 3;
const EXPECTED_TRAJECTORY_COUNT = 2;
const TARGET_FOOTPRINT_BYTES = 128;
const FLOAT_PRECISION = 10;

const fixture = (name: string): Promise<unknown> =>
  Bun.file(new URL(`../fixtures/${name}`, import.meta.url)).json();

const loadBenchmarkFixture = async () =>
  decodeUnknown(
    EvolutionBenchmarkOperation,
    await fixture("benchmark-request.json"),
    "fixture",
  );

const loadCodeCheckFixture = async () =>
  decodeUnknown(
    EvolutionCodeCheckRequest,
    await fixture("code-check-request.json"),
    "fixture",
  );

const loadComparisonFixture = async () =>
  decodeUnknown(
    EvolutionComparisonRequest,
    await fixture("evaluation-request.json"),
    "fixture",
  );

const makeBaselineRequest = (comparison: EvolutionComparisonRequest) => {
  const run = EvolutionRun.make({
    id: comparison.run.id,
    principalId: comparison.run.principalId,
    baselineSnapshotId: comparison.run.baselineSnapshotId,
    engineRef: comparison.run.engineRef,
    engineKind: comparison.run.engineKind,
    configurationDigest: comparison.run.configurationDigest,
    signalIds: comparison.run.signalIds,
    datasetId: comparison.dataset.id,
    datasetDigest: comparison.dataset.digest,
    target: comparison.run.target,
    budgets: comparison.run.budgets,
    state: DatasetReadyRunState.make({
      datasetId: comparison.dataset.id,
      datasetDigest: comparison.dataset.digest,
    }),
    createdAt: comparison.run.createdAt,
    updatedAt: comparison.run.updatedAt,
  });
  const plan = {
    operation: "baseline" as const,
    run,
    dataset: comparison.dataset,
    baselineSnapshotId: comparison.baselineSnapshotId,
    evaluatorRef: comparison.evaluatorRef,
    authoringRouteDigest: comparison.authoringRouteDigest,
    evaluationRouteDigest: comparison.evaluationRouteDigest,
    environmentDigest: comparison.environmentDigest,
    seed: comparison.seed,
    targetFootprintBytes: TARGET_FOOTPRINT_BYTES,
    metrics: comparison.metrics,
  };
  return EvolutionBaselineRequest.make({
    ...plan,
    evaluationPlanDigest: sha256Text(canonicalJson(plan)),
  });
};

beforeEach(() => {
  Bun.env["ELLIOTT_COMPANION_FIXTURE"] = "1";
  Bun.env["ELLIOTT_BENCHMARK_DRIVER_CONFIG"] = new URL(
    "benchmark-drivers.json",
    import.meta.url,
  ).pathname;
});

describe("benchmark runner", () => {
  test("runs a bound benchmark fixture", async () => {
    const result = await runBenchmark(await fixture("benchmark-request.json"));
    expect(result.passed).toBeTrue();
    expect(result.maximumRegressionRatio).toBeCloseTo(
      EXPECTED_REGRESSION_RATIO,
      FLOAT_PRECISION,
    );
    expect(result.reportDigest).toStartWith("sha256:");
  });

  test("rejects a candidate bound to another run", async () => {
    const request = await loadBenchmarkFixture();
    const candidate = EvolutionCandidate.make({
      ...request.candidate,
      runId: EvolutionRunIdSchema.make("evr_smoke999"),
    });
    expect(
      runBenchmark(
        EvolutionBenchmarkOperation.make({
          ...request,
          candidate,
        }),
      ),
    ).rejects.toThrow("not bound");
  });

  test("rejects an unknown benchmark driver", async () => {
    const request = await loadBenchmarkFixture();
    expect(
      runBenchmark(
        EvolutionBenchmarkOperation.make({
          ...request,
          benchmarkRef: "invented",
        }),
      ),
    ).rejects.toThrow("not configured");
  });
});

describe("code-check runner", () => {
  test("returns a complete, bound code-check fixture report", async () => {
    const report = await checkCandidate(
      await fixture("code-check-request.json"),
    );
    expect(report.candidateId).toBe("evc_codecheck1");
    expect(report.constraints).toHaveLength(EXPECTED_CONSTRAINT_COUNT);
  });

  test("rejects code candidate digest drift", async () => {
    const request = await loadCodeCheckFixture();
    const candidate = EvolutionCandidate.make({
      ...request.candidate,
      candidateDigest: "sha256:wrong",
    });
    expect(
      checkCandidate(
        EvolutionCodeCheckRequest.make({
          ...request,
          candidate,
        }),
      ),
    ).rejects.toThrow("materialized digest");
  });
});

describe("evaluation runner", () => {
  test("runs the independent comparison and complete ladder", async () => {
    const request = await loadComparisonFixture();
    const report = await compare(request);
    expect(report.passed).toBeTrue();
    expect(report.benchmarks).toHaveLength(request.benchmarkGates.length);
    expect(
      report.baselineCases.every((item) => item.trajectoryDigest !== undefined),
    ).toBeTrue();
  });

  test("measures the sealed pre-optimization baseline", async () => {
    const comparison = await loadComparisonFixture();
    const report = await baseline(makeBaselineRequest(comparison));
    expect(report.caseResults.map((item) => item.split)).toEqual([
      "validation",
      "holdout",
    ]);
    expect(report.trajectoryDigests).toHaveLength(EXPECTED_TRAJECTORY_COUNT);
    expect(new Set(report.footprints.map((item) => item.category))).toEqual(
      new Set(["prompt", "inference", "runtime"]),
    );
  });
});
