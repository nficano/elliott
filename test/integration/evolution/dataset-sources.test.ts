import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeFileEvolutionDatasetFactory } from "../../../src/learning/evolution/application/files";
import {
  EvolutionTarget,
  EvolutionUnsplitDatasetCase,
} from "../../../src/learning/evolution/model/index";
import { SessionStore } from "../../../src/memory/session-store/index";

const roots: string[] = [];
const TARGET_REF = "workspace/skill/review";

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const target = () =>
  EvolutionTarget.make({
    targetClass: "skill",
    componentRef: TARGET_REF,
    baselineDigest: "sha256:target",
    riskClass: "C1",
    mutationPath: "skills/review/SKILL.md",
    allowedMutationPaths: ["skills/review/SKILL.md"],
    frozenPaths: ["skills/review/manifest.yaml"],
  });

const goldenCases = () =>
  Array.from({ length: 15 }, (_, index) =>
    EvolutionUnsplitDatasetCase.make({
      id: `golden-${index}`,
      groupId: `golden-${index}`,
      input: { task: index },
      expected: { correct: true },
      classification: "internal",
      sourceDigests: ["sha256:golden"],
      timeoutMilliseconds: 1000,
      maximumCostUsd: 0,
      allowedEffects: [],
    }));

describe("runtime evolution dataset sources", () => {
  it("seals deterministic synthetic, golden, target-specific, and benchmark sources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-datasets-"));
    roots.push(root);
    const file = path.join(root, "cases.jsonl");
    await writeFile(
      file,
      `${goldenCases().map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    const factory = makeFileEvolutionDatasetFactory(root, {
      train: 0.6,
      validation: 0.2,
      holdout: 0.2,
    });
    const benchmarkTasks = Array.from(
      { length: 15 },
      (_, index) => `task-${index}`,
    ).join(",");
    const sources = [
      ["synthetic", "synthetic"],
      ["golden:cases.jsonl", "golden"],
      ["target-specific:cases.jsonl", "target-specific"],
      [`benchmark:tblite#${benchmarkTasks}`, "benchmark"],
    ] as const;
    for (const [source, kind] of sources) {
      const dataset = await Effect.runPromise(
        factory.build(target(), [source], 7),
      );
      expect(dataset.holdoutSealed).toBeTrue();
      expect(dataset.sources[0]?.kind).toBe(kind);
      expect(dataset.cases).toHaveLength(kind === "synthetic" ? 20 : 15);
    }
  });

  it("builds a sealed session-derived dataset from durable evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-sessions-"));
    roots.push(root);
    const database = path.join(root, "sessions.sqlite");
    const sessions = new SessionStore(database);
    for (let index = 0; index < 15; index++) {
      sessions.evolution.recordFeedback({
        id: `feedback-${index}`,
        runId: `run-${index}`,
        targetRef: TARGET_REF,
        kind: index % 2 === 0
          ? "confirmed-success"
          : "explicit-correction",
        evidenceDigest: `sha256:evidence-${index}`,
        createdAt: new Date(index).toISOString(),
      });
    }
    sessions.close();
    const factory = makeFileEvolutionDatasetFactory(
      root,
      { train: 0.6, validation: 0.2, holdout: 0.2 },
      { sessionDatabase: database },
    );
    const dataset = await Effect.runPromise(
      factory.build(target(), ["session"], 11),
    );
    expect(dataset.sources[0]?.kind).toBe("session");
    expect(dataset.cases).toHaveLength(15);
    expect(dataset.holdoutSealed).toBeTrue();
  });

  it("bootstraps policy-sized defaults for every target class", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-bootstrap-"));
    roots.push(root);
    const factory = makeFileEvolutionDatasetFactory(root, {
      train: 0.6,
      validation: 0.2,
      holdout: 0.2,
    });
    const expected = new Map(
      [
        ["skill", 20],
        ["tool-description", 200],
        ["prompt-segment", 60],
        ["code", 3],
      ] as const,
    );
    for (const [targetClass, count] of expected) {
      const dataset = await Effect.runPromise(factory.build(
        EvolutionTarget.make({
          ...target(),
          targetClass,
          componentRef: `workspace/${targetClass}/target`,
        }),
        [],
        17,
      ));
      expect(dataset.cases).toHaveLength(count);
      expect(dataset.sources[0]?.kind).toBe("synthetic");
    }
  });

  it("builds catalog-wide positive, ambiguous, and no-tool cases", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-tool-catalog-"));
    roots.push(root);
    const tools = ["search", "fetch", "send"].map((name) => ({
      name,
      description: `${name} description`,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
      },
      execute: async () => "",
    }));
    const factory = makeFileEvolutionDatasetFactory(
      root,
      { train: 0.6, validation: 0.2, holdout: 0.2 },
      { runtimeTools: tools },
    );
    const dataset = await Effect.runPromise(factory.build(
      EvolutionTarget.make({
        ...target(),
        targetClass: "tool-description",
        componentRef: "core/tool/description-catalog",
        baselineDigest: "sha256:catalog",
      }),
      [],
      23,
    ));
    expect(dataset.cases).toHaveLength(200);
    expect(
      new Set(
        dataset.cases.flatMap((item) => {
          const toolRef = item.expected["toolRef"];
          return typeof toolRef === "string" ? [toolRef] : [];
        }),
      ),
    ).toEqual(new Set(["search", "fetch", "send"]));
    expect(
      dataset.cases.filter((item) => item.id.startsWith("tool-ambiguous-")),
    ).toHaveLength(10);
    expect(
      dataset.cases.filter((item) => item.expected["toolRef"] === null),
    ).toHaveLength(10);
    expect(
      dataset.cases.every((item) =>
        item.sourceDigests.includes("sha256:catalog")
      ),
    ).toBeTrue();
  });

  it("combines curated reproductions with generated code edge cases", async () => {
    const root = path.resolve(import.meta.dir, "../../..");
    const codeTarget = EvolutionTarget.make({
      ...target(),
      targetClass: "code",
      componentRef: "core/code/duckduckgo-parser",
    });
    const factory = makeFileEvolutionDatasetFactory(
      root,
      { train: 0.6, validation: 0.2, holdout: 0.2 },
      {
        defaultSources: {
          [codeTarget.componentRef]: [
            "target-specific:skills/search-duckduckgo/evals/evolution.yaml",
            "synthetic:3",
          ],
        },
      },
    );
    const dataset = await Effect.runPromise(factory.build(codeTarget, [], 19));
    expect(dataset.cases).toHaveLength(6);
    expect(dataset.sources.map((item) => item.kind)).toEqual([
      "target-specific",
      "synthetic",
    ]);
    expect(
      dataset.cases.some((item) => item.id === "code-redirect-destination"),
    ).toBeTrue();
  });
});
