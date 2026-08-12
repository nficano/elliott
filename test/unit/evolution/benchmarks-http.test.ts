import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { decodeUnknown } from "../../../darwin/runtime/wire";
import {
  makeHttpEvolutionBenchmarkRunner,
  unavailableEvolutionBenchmarkRunner,
} from "../../../src/learning/evolution/benchmarks/http";
import {
  EvolutionBenchmarkOperation,
  EvolutionBenchmarkResult,
} from "../../../src/learning/evolution/model/index";

const loadOperation = async () =>
  decodeUnknown(
    EvolutionBenchmarkOperation,
    await Bun.file(
      new URL(
        "../../../darwin/evaluators/agent-benchmarks/fixtures/benchmark.json",
        import.meta.url,
      ),
    ).json(),
    "fixture",
  );

const resultFor = (operation: EvolutionBenchmarkOperation) =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: operation.benchmarkRef,
    scope: "candidate",
    baselineScore: 1,
    candidateScore: 1,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 1,
    reportDigest: "sha256:report",
    status: "passed",
    passed: true,
  });

describe("HTTP evolution benchmark runner", () => {
  it("posts /v1/run and decodes the result", async () => {
    const operation = await loadOperation();
    const runner = makeHttpEvolutionBenchmarkRunner(
      "https://bench.test",
      (async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer tok",
        );
        return Response.json(resultFor(operation), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      "tok",
    );
    const result = await Effect.runPromise(runner.invoke(operation));
    expect(result.passed).toBe(true);
  });

  it("maps HTTP failures and unavailable runners", async () => {
    const operation = await loadOperation();
    const failing = makeHttpEvolutionBenchmarkRunner(
      "https://bench.test",
      (async () =>
        new Response("no", { status: 502 })) as unknown as typeof fetch,
    );
    expect((await Effect.runPromiseExit(failing.invoke(operation)))._tag)
      .toBe("Failure");
    const unavailable = unavailableEvolutionBenchmarkRunner("offline");
    expect((await Effect.runPromiseExit(unavailable.invoke(operation)))._tag)
      .toBe("Failure");
  });
});
