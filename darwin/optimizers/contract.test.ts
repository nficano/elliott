/* eslint-disable no-magic-numbers */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { decodeOptimizerRequest, decodeOptimizerResult } from "./contract";

const fixturePath = (name: string): string =>
  path.join(import.meta.dir, name, "fixtures/request.json");

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
};

const array = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new TypeError("expected an array");
  return value.map((item: unknown) => item);
};

const fixture = async (
  name: string,
): Promise<Readonly<Record<string, unknown>>> =>
  record(await Bun.file(fixturePath(name)).json());

describe("TypeScript optimizer request contract", () => {
  test("decodes a bound text optimizer request", async () => {
    const request = decodeOptimizerRequest(await fixture("dspy"), "text");
    expect(request.run.id).toMatch(/^evr_smoke001$/);
    expect(request.codeSandbox).toBeUndefined();
  });

  test("keeps holdout data out of optimizer requests", async () => {
    const value = await fixture("dspy");
    const poisoned = {
      ...value,
      dataset: {
        ...record(value["dataset"]),
        holdoutCases: [],
      },
    };
    expect(() => decodeOptimizerRequest(poisoned, "text")).toThrow(
      "unexpected fields",
    );
  });

  test("rejects unsafe code sandbox commands and digest drift", async () => {
    const value = await fixture("darwinian");
    const sandbox = record(value["codeSandbox"]);
    const unsafe = {
      ...value,
      codeSandbox: {
        ...sandbox,
        testCommands: [["sh", "-c", "bun test"]],
      },
    };
    expect(() => decodeOptimizerRequest(unsafe, "code")).toThrow(
      "isolation contract",
    );

    const files = array(sandbox["checkoutFiles"]);
    const first = record(files[0]);
    const drifted = {
      ...value,
      codeSandbox: {
        ...sandbox,
        checkoutFiles: [
          { ...first, digest: `sha256:${"0".repeat(64)}` },
          ...files.slice(1),
        ],
      },
    };
    expect(() => decodeOptimizerRequest(drifted, "code")).toThrow(
      "isolation contract",
    );
  });
});

describe("TypeScript optimizer result contract", () => {
  test("constructs the public candidate envelope in TypeScript", async () => {
    const request = decodeOptimizerRequest(await fixture("dspy"), "text");
    const result = decodeOptimizerResult({
      candidates: [{
        materializedContent: "optimized",
        patch: "--- a/SKILL.md\n+++ b/SKILL.md\n",
        trace: { engine: "fixture" },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMilliseconds: 0,
        },
        validationScore: 1,
      }],
    }, request);
    expect(result.runId).toBe(request.run.id);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateDigest).toMatch(/^sha256:/);
  });
});
