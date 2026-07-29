import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EvolutionBenchmarkResult } from "../../../../src/learning/evolution/model/index";
import { wireError } from "../../../runtime/wire";
import { fixtureResult, loadConfiguration, validateOperation } from "./config";
import { runDriver } from "./driver";
import { makeResult } from "./result";

const WORK_DIRECTORY_MODE = 0o700;

export const configuredBenchmarkReferences = async (): Promise<
  ReadonlySet<string>
> => new Set(Object.keys((await loadConfiguration()).drivers));

export const runBenchmark = async (
  value: unknown,
): Promise<EvolutionBenchmarkResult> => {
  const operation = validateOperation(value);
  const configuration = await loadConfiguration();
  const driver = configuration.drivers[operation.benchmarkRef];
  if (driver === undefined) {
    return wireError(`driver ${operation.benchmarkRef} is not configured`);
  }
  const work = await mkdtemp(path.join(tmpdir(), "elliott-benchmark-"));
  try {
    if (Bun.env["ELLIOTT_COMPANION_FIXTURE"] === "1") {
      return makeResult({
        operation,
        driver,
        raw: fixtureResult(operation, driver),
        processEvidence: { fixture: true },
      });
    }
    const output = await runDriver(operation, driver, work);
    return makeResult({
      operation,
      driver,
      raw: output.raw,
      processEvidence: output.processEvidence,
    });
  } finally {
    await chmod(work, WORK_DIRECTORY_MODE);
    await rm(work, { recursive: true, force: true });
  }
};
