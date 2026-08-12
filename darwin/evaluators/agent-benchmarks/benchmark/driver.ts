import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvolutionBenchmarkOperation } from "../../../../src/learning/evolution/model/index";
import {
  canonicalJson,
  decodeUnknown,
  MAX_RESPONSE_BYTES,
  wireError,
} from "../../../runtime/wire";
import {
  type BenchmarkDriver,
  operationBinding,
  PASSTHROUGH_ENVIRONMENT,
  type ProcessEvidence,
  RawBenchmarkResult,
  type RawBenchmarkResultType,
} from "./config";

const TIMEOUT_EXIT_CODE = 124;

interface DriverProcess {
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly kill: () => void;
}

const renderArgument = (
  argument: string,
  values: Readonly<Record<string, string>>,
): string => {
  const rendered = Object.entries(values).reduce(
    (current, [name, value]) => current.split(`{${name}}`).join(value),
    argument,
  );
  return rendered.includes("{") || rendered.includes("}")
    ? wireError(`unresolved benchmark command placeholder in ${argument}`)
    : rendered;
};

const childEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        PASSTHROUGH_ENVIRONMENT.has(entry[0]) && entry[1] !== undefined,
    ),
  );

const digestStream = async (
  stream: ReadableStream<Uint8Array>,
  child: DriverProcess,
): Promise<string> => {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let size = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      child.kill();
      return wireError("benchmark driver output exceeds the size limit");
    }
    hash.update(item.value);
  }
  return `sha256:${hash.digest("hex")}`;
};

const waitForChild = async (
  child: DriverProcess,
  timeoutMilliseconds: number,
): Promise<{ readonly exitCode: number; readonly timedOut: boolean; }> => {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMilliseconds);
  try {
    const exitCode = await child.exited;
    return { exitCode: timedOut ? TIMEOUT_EXIT_CODE : exitCode, timedOut };
  } finally {
    clearTimeout(timeout);
  }
};

const failedRaw = (
  operation: EvolutionBenchmarkOperation,
  latencyMilliseconds: number,
  driverFailure: string,
): RawBenchmarkResultType => ({
  bindings: operationBinding(operation),
  baselineScore: 0,
  candidateScore: 0,
  costUsd: 0,
  latencyMilliseconds,
  driverFailure,
});

const spawnDriver = (
  command: readonly string[],
  work: string,
): DriverProcess =>
  Bun.spawn([...command], {
    cwd: work,
    env: childEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

const collectProcess = async (
  child: DriverProcess,
  timeoutMilliseconds: number,
) => {
  const [outcome, stdoutDigest, stderrDigest] = await Promise.all([
    waitForChild(child, timeoutMilliseconds),
    digestStream(child.stdout, child),
    digestStream(child.stderr, child),
  ]);
  return {
    outcome,
    processEvidence: {
      exitCode: outcome.exitCode,
      stdoutDigest,
      stderrDigest,
    } satisfies ProcessEvidence,
  };
};

const readDriverResult = async (
  resultPath: string,
  latencyMilliseconds: number,
): Promise<RawBenchmarkResultType> => {
  const resultSize = (await stat(resultPath)).size;
  if (resultSize > MAX_RESPONSE_BYTES) {
    return wireError("benchmark driver result exceeds the size limit");
  }
  const raw = decodeUnknown(
    RawBenchmarkResult,
    JSON.parse(await readFile(resultPath, "utf8")),
    "benchmark driver result",
  );
  return {
    ...raw,
    latencyMilliseconds: raw.latencyMilliseconds ?? latencyMilliseconds,
  };
};

const buildCommand = async (
  operation: EvolutionBenchmarkOperation,
  driver: BenchmarkDriver,
  work: string,
): Promise<readonly string[]> => {
  if (
    driver.argv.length === 0
    || driver.argv.some((item) => item.length === 0)
  ) {
    return wireError("benchmark driver argv must be non-empty");
  }
  const requestPath = path.join(work, "operation.json");
  const resultPath = path.join(work, "result.json");
  await writeFile(requestPath, canonicalJson(operation), { mode: 0o600 });
  return driver.argv.map((item) =>
    renderArgument(item, {
      request: requestPath,
      result: resultPath,
      work,
      benchmarkRef: operation.benchmarkRef,
      baselineSnapshotId: operation.baselineSnapshotId,
      candidateSnapshotId: operation.candidateSnapshotId,
      environmentDigest: operation.environmentDigest,
      seed: String(operation.seed),
    })
  );
};

const finalizeDriver = async (input: {
  readonly operation: EvolutionBenchmarkOperation;
  readonly work: string;
  readonly outcome: { readonly exitCode: number; readonly timedOut: boolean; };
  readonly processEvidence: ProcessEvidence;
  readonly latencyMilliseconds: number;
}): Promise<{
  readonly raw: RawBenchmarkResultType;
  readonly processEvidence: ProcessEvidence;
}> => {
  const { operation, work, outcome, processEvidence, latencyMilliseconds } =
    input;
  if (outcome.timedOut) {
    return {
      raw: failedRaw(operation, latencyMilliseconds, "timeout"),
      processEvidence,
    };
  }
  const resultPath = path.join(work, "result.json");
  let resultSize = 0;
  try {
    resultSize = (await stat(resultPath)).size;
  } catch {
    // Missing result is reported as a bound driver failure below.
  }
  if (outcome.exitCode !== 0 || resultSize === 0) {
    return {
      raw: failedRaw(
        operation,
        latencyMilliseconds,
        `exit-${outcome.exitCode}`,
      ),
      processEvidence,
    };
  }
  return {
    raw: await readDriverResult(resultPath, latencyMilliseconds),
    processEvidence,
  };
};

export const runDriver = async (
  operation: EvolutionBenchmarkOperation,
  driver: BenchmarkDriver,
  work: string,
): Promise<{
  readonly raw: RawBenchmarkResultType;
  readonly processEvidence: ProcessEvidence;
}> => {
  const command = await buildCommand(operation, driver, work);
  const started = performance.now();
  const child = spawnDriver(command, work);
  const { outcome, processEvidence } = await collectProcess(
    child,
    operation.timeoutMilliseconds,
  );
  return finalizeDriver({
    operation,
    work,
    outcome,
    processEvidence,
    latencyMilliseconds: Math.round(performance.now() - started),
  });
};
