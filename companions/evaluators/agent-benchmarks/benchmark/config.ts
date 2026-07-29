import * as Schema from "effect/Schema";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  EvolutionBenchmarkOperation,
} from "../../../../src/learning/evolution/model/index";
import { decodeUnknown, wireError } from "../../../runtime/wire";

const DEFAULT_DRIVER_CONFIG =
  "/opt/elliott/companions/evaluators/agent-benchmarks/benchmark/drivers.json";
const CONFIG_UNAVAILABLE_STATUS = 500;

export const DRIVER_SCOPES = new Set(["candidate", "shortlist", "release"]);

export const PASSTHROUGH_ENVIRONMENT = new Set([
  "ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT",
  "ELLIOTT_BENCHMARK_EXECUTOR_TOKEN",
  "LANG",
  "LC_ALL",
  "PATH",
]);

export class BenchmarkDriver extends Schema.Class<BenchmarkDriver>(
  "BenchmarkDriver",
)({
  name: Schema.String,
  source: Schema.String,
  revision: Schema.String,
  scope: Schema.Literals(["candidate", "shortlist", "release"]),
  maximumRegressionRatio: Schema.Number,
  argv: Schema.Array(Schema.String),
}) {}

class BenchmarkConfiguration extends Schema.Class<BenchmarkConfiguration>(
  "BenchmarkConfiguration",
)({
  schemaVersion: Schema.Literal(1),
  drivers: Schema.Record(Schema.String, BenchmarkDriver),
}) {}

export const RawBenchmarkResult = Schema.Struct({
  bindings: Schema.Struct({
    benchmarkRef: Schema.String,
    baselineSnapshotId: Schema.String,
    candidateSnapshotId: Schema.String,
    environmentDigest: Schema.String,
    seed: Schema.Int,
  }),
  baselineScore: Schema.Number,
  candidateScore: Schema.Number,
  costUsd: Schema.Number,
  latencyMilliseconds: Schema.optionalKey(Schema.Int),
  driverFailure: Schema.optionalKey(Schema.String),
  evidence: Schema.optionalKey(Schema.Unknown),
});

export type RawBenchmarkResultType = typeof RawBenchmarkResult.Type;

export interface ProcessEvidence {
  readonly exitCode?: number;
  readonly stdoutDigest?: string;
  readonly stderrDigest?: string;
  readonly fixture?: true;
}

export const operationBinding = (operation: EvolutionBenchmarkOperation) => ({
  benchmarkRef: operation.benchmarkRef,
  baselineSnapshotId: operation.baselineSnapshotId,
  candidateSnapshotId: operation.candidateSnapshotId,
  environmentDigest: operation.environmentDigest,
  seed: operation.seed,
});

export const validateOperation = (
  value: unknown,
): EvolutionBenchmarkOperation => {
  const operation = decodeUnknown(
    EvolutionBenchmarkOperation,
    value,
    "benchmark operation",
  );
  if (
    operation.run.id !== operation.candidate.runId
    || operation.run.target.baselineDigest !== operation.candidate.targetDigest
    || operation.run.baselineSnapshotId !== operation.baselineSnapshotId
  ) {
    return wireError("candidate is not bound to the benchmark run");
  }
  return operation;
};

export const loadConfiguration = async (): Promise<BenchmarkConfiguration> => {
  const configPath = Bun.env["ELLIOTT_BENCHMARK_DRIVER_CONFIG"]
    ?? DEFAULT_DRIVER_CONFIG;
  if (!path.isAbsolute(configPath)) {
    return wireError(
      "benchmark driver configuration must be absolute",
      CONFIG_UNAVAILABLE_STATUS,
    );
  }
  let encoded: string;
  try {
    encoded = await readFile(configPath, "utf8");
  } catch {
    return wireError(
      "benchmark driver configuration is unavailable",
      CONFIG_UNAVAILABLE_STATUS,
    );
  }
  try {
    return decodeUnknown(
      BenchmarkConfiguration,
      JSON.parse(encoded),
      "benchmark configuration",
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return wireError(
        "benchmark driver configuration is invalid",
        CONFIG_UNAVAILABLE_STATUS,
      );
    }
    throw error;
  }
};

export const fixtureResult = (
  operation: EvolutionBenchmarkOperation,
  driver: BenchmarkDriver,
): RawBenchmarkResultType => ({
  bindings: operationBinding(operation),
  baselineScore: 1,
  candidateScore: 1,
  costUsd: 0,
  latencyMilliseconds: 0,
  evidence: { fixture: true, driverRevision: driver.revision },
});
