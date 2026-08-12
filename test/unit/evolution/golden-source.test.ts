import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadGoldenDatasetSource } from "../../../src/learning/evolution/datasets/sources/golden";

describe("loadGoldenDatasetSource", () => {
  it("loads jsonl golden cases and fails closed on bad input", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-golden-"));
    try {
      const filePath = path.join(root, "cases.jsonl");
      await writeFile(
        filePath,
        `${
          JSON.stringify({
            id: "case-1",
            groupId: "group-1",
            input: "q",
            expected: "a",
            classification: "internal",
            sourceDigests: ["sha256:golden"],
            timeoutMilliseconds: 1000,
            maximumCostUsd: 0,
            allowedEffects: [],
          })
        }\n`,
      );
      const loaded = await Effect.runPromise(loadGoldenDatasetSource({
        filePath,
        sourceDigest: "sha256:golden",
        classification: "internal",
      }));
      expect(loaded.cases).toHaveLength(1);

      await expect(
        Effect.runPromise(loadGoldenDatasetSource({
          filePath: path.join(root, "missing.jsonl"),
          sourceDigest: "sha256:missing",
          classification: "internal",
        })),
      ).rejects.toHaveProperty("_tag", "EvolutionDatasetError");

      const bad = path.join(root, "bad.jsonl");
      await writeFile(bad, "{not-json\n");
      await expect(
        Effect.runPromise(loadGoldenDatasetSource({
          filePath: bad,
          sourceDigest: "sha256:bad",
          classification: "internal",
        })),
      ).rejects.toHaveProperty("_tag", "EvolutionDatasetError");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
