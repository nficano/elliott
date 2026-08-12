import { describe, expect, it } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BenchmarkDriver,
} from "../../../darwin/evaluators/agent-benchmarks/benchmark/config";
import {
  runDriver,
} from "../../../darwin/evaluators/agent-benchmarks/benchmark/driver";
import { decodeUnknown } from "../../../darwin/runtime/wire";
import {
  EvolutionBenchmarkOperation,
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

const driver = (argv: readonly string[]) =>
  BenchmarkDriver.make({
    name: "smoke",
    source: "local",
    revision: "1",
    scope: "candidate",
    maximumRegressionRatio: 0.1,
    argv,
  });

describe("runDriver", () => {
  it("runs a successful local argv script and reads result.json", async () => {
    const operation = await loadOperation();
    const work = await mkdtemp(path.join(tmpdir(), "bench-driver-"));
    const script = path.join(work, "run.sh");
    await writeFile(
      script,
      `#!/bin/sh
cat > "$2" <<'EOF'
{"bindings":{"benchmarkRef":"core/evaluator/smoke","baselineSnapshotId":"snap-b","candidateSnapshotId":"snap-c","environmentDigest":"sha256:env","seed":1},"baselineScore":1,"candidateScore":1,"costUsd":0,"passed":true}
EOF
`,
    );
    await chmod(script, 0o755);
    const outcome = await runDriver(
      {
        ...operation,
        timeoutMilliseconds: 5000,
      },
      driver(["/bin/sh", script, "{request}", "{result}"]),
      work,
    );
    expect(outcome.raw.baselineScore).toBe(1);
    expect(outcome.raw.candidateScore).toBe(1);
    expect(outcome.processEvidence.exitCode).toBe(0);
  });

  it("reports exit failures when the script does not write a result", async () => {
    const operation = await loadOperation();
    const work = await mkdtemp(path.join(tmpdir(), "bench-driver-"));
    const outcome = await runDriver(
      { ...operation, timeoutMilliseconds: 5000 },
      driver(["/bin/sh", "-c", "exit 7"]),
      work,
    );
    expect(outcome.raw.driverFailure).toBe("exit-7");
  });

  it("rejects empty argv and unresolved placeholders", async () => {
    const operation = await loadOperation();
    const work = await mkdtemp(path.join(tmpdir(), "bench-driver-"));
    await expect(
      runDriver(operation, driver([]), work),
    ).rejects.toThrow(/non-empty|argv/);
    await expect(
      runDriver(operation, driver(["echo", "{missing}"]), work),
    ).rejects.toThrow(/unresolved/);
  });
});
