/* eslint-disable no-magic-numbers */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { JobController } from "./controller";

const worker = path.join(import.meta.dir, "fixtures/slow-worker.ts");
const fixture = path.join(import.meta.dir, "../dspy/fixtures/request.json");

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
};

const controller = () =>
  new JobController({
    kind: "text",
    workerCommand: [process.execPath, worker],
    sliceMilliseconds: 30,
    maximumJobs: 1,
  });

const request = async (runId: string): Promise<unknown> => {
  const value = record(await Bun.file(fixture).json());
  return {
    ...value,
    run: { ...record(value["run"]), id: runId },
  };
};

describe("TypeScript darwin job controller", () => {
  test("really pauses and resumes a worker process group", async () => {
    const jobs = controller();
    let result = record(await jobs.start(await request("evr_12345678")));
    expect(result["paused"]).toBe(true);
    const token = result["resumeToken"];
    expect(typeof token).toBe("string");

    // Generous slice budget: CI runners need bun cold-start plus the
    // worker's 200ms of work delivered in 30ms wall-clock slices.
    for (let attempt = 0; attempt < 200 && result["paused"]; attempt += 1) {
      result = record(await jobs.resume(String(token)));
    }
    expect(result["paused"]).toBe(false);
    expect(result["runId"]).toBe("evr_12345678");
  });

  test("cancels idempotently", async () => {
    const jobs = controller();
    const result = record(await jobs.start(await request("evr_87654321")));
    expect(result["paused"]).toBe(true);
    await jobs.cancel("evr_87654321");
    await jobs.cancel("evr_87654321");
  });

  test("serializes concurrent starts against the global limit", async () => {
    const jobs = controller();
    const outcomes = await Promise.allSettled([
      jobs.start(await request("evr_concurrent01")),
      jobs.start(await request("evr_concurrent02")),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const completed = outcomes.find((outcome) =>
      outcome.status === "fulfilled"
    );
    if (completed?.status !== "fulfilled") {
      throw new TypeError("expected one started job");
    }
    const result = record(completed.value);
    await jobs.cancel(String(result["runId"]));
  });
});
