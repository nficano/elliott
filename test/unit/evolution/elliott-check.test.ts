import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as Effect from "effect/Effect";
import { Readable } from "node:stream";
import {
  runElliottCheck,
} from "../../../src/learning/evolution/benchmarks/elliott-check";
import { makeCandidate } from "./helpers";

afterEach(() => {
  mock.restore();
});

const fakeSpawn = (exitCode: number): typeof Bun.spawn => ((() => ({
  stdout: Readable.toWeb(Readable.from([""])),
  stderr: Readable.toWeb(Readable.from([""])),
  exited: Promise.resolve(exitCode),
  kill: () => undefined,
})) as unknown as typeof Bun.spawn);

describe("runElliottCheck", () => {
  it("records a passed benchmark when bun run check exits 0", async () => {
    spyOn(Bun, "spawn").mockImplementation(fakeSpawn(0));
    const result = await Effect.runPromise(runElliottCheck({
      checkout: "/var/checkout",
      candidate: makeCandidate(),
      baselinePassed: true,
      timeoutMilliseconds: 5000,
    }));
    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.candidateScore).toBe(1);
    expect(result.baselineScore).toBe(1);
  });

  it("records a failed benchmark on non-zero exit", async () => {
    spyOn(Bun, "spawn").mockImplementation(fakeSpawn(1));
    const result = await Effect.runPromise(runElliottCheck({
      checkout: "/var/checkout",
      candidate: makeCandidate(),
      baselinePassed: false,
      timeoutMilliseconds: 5000,
    }));
    expect(result.passed).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.candidateScore).toBe(0);
    expect(result.baselineScore).toBe(0);
  });
});
