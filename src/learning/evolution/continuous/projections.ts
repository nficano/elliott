import * as Schema from "effect/Schema";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { EvolutionPerformanceProjection } from "../model/index";
import {
  EvolutionPerformanceProjection as EvolutionPerformanceProjectionSchema,
} from "../model/index";
import type { EvolutionTarget } from "../model/index";
import type { EvolutionProjectionStore } from "./types";

const sortedProjections = (
  values: ReadonlyMap<string, EvolutionPerformanceProjection>,
): readonly EvolutionPerformanceProjection[] =>
  [...values.values()].toSorted((left, right) =>
    left.targetRef.localeCompare(right.targetRef)
  );

const average = (values: readonly number[], fallback: number): number =>
  values.length === 0
    ? fallback
    : values.reduce((total, value) => total + value, 0) / values.length;

export const projectEvolutionPerformance = (
  run: {
    readonly target: Pick<
      EvolutionTarget,
      "componentRef" | "targetClass" | "baselineDigest"
    >;
  },
  report: {
    readonly candidateCases: readonly { readonly passed: boolean; }[];
    readonly benchmarks: readonly {
      readonly status: string;
      readonly candidateScore: number;
    }[];
    readonly metrics: readonly { readonly candidate: number; }[];
    readonly totalCostUsd: number;
    readonly createdAt: string;
  },
  correctionRate = 0,
): EvolutionPerformanceProjection => {
  const successRate = report.candidateCases.length === 0
    ? 0
    : report.candidateCases.filter((item) => item.passed).length
      / report.candidateCases.length;
  const benchmarkScore = average(
    report.benchmarks
      .filter((item) => item.status !== "not-applicable")
      .map((item) => item.candidateScore),
    average(report.metrics.map((item) => item.candidate), successRate),
  );
  return EvolutionPerformanceProjectionSchema.make({
    targetRef: run.target.componentRef,
    targetClass: run.target.targetClass,
    targetDigest: run.target.baselineDigest,
    successRate,
    correctionRate: Math.max(0, Math.min(1, correctionRate)),
    benchmarkScore,
    averageCostUsd: report.totalCostUsd
      / Math.max(1, report.candidateCases.length),
    sampleCount: report.candidateCases.length,
    projectedAt: report.createdAt,
  });
};

export class InMemoryEvolutionProjectionStore
  implements EvolutionProjectionStore
{
  readonly #values = new Map<string, EvolutionPerformanceProjection>();

  put(projection: EvolutionPerformanceProjection): void {
    this.#values.set(projection.targetRef, projection);
  }

  get(targetRef: string): EvolutionPerformanceProjection | undefined {
    return this.#values.get(targetRef);
  }

  list(): readonly EvolutionPerformanceProjection[] {
    return sortedProjections(this.#values);
  }
}

const projectionFileName = (targetRef: string): string =>
  `${Buffer.from(targetRef).toString("base64url")}.json`;

const loadProjectionFile = (filePath: string): EvolutionPerformanceProjection =>
  Schema.decodeUnknownSync(EvolutionPerformanceProjectionSchema)(
    JSON.parse(readFileSync(filePath, "utf8")),
  );

export class FileEvolutionProjectionStore implements EvolutionProjectionStore {
  readonly #root: string;
  readonly #values = new Map<string, EvolutionPerformanceProjection>();

  constructor(root: string) {
    this.#root = path.resolve(root);
    mkdirSync(this.#root, { recursive: true });
    for (
      const name of readdirSync(this.#root)
        .filter((entry) => path.extname(entry) === ".json")
        .toSorted((left, right) => left.localeCompare(right))
    ) {
      const projection = loadProjectionFile(path.join(this.#root, name));
      this.#values.set(projection.targetRef, projection);
    }
  }

  put(projection: EvolutionPerformanceProjection): void {
    const filePath = path.join(
      this.#root,
      projectionFileName(projection.targetRef),
    );
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(projection, undefined, 2)}\n`,
      { flag: "wx" },
    );
    renameSync(temporaryPath, filePath);
    this.#values.set(projection.targetRef, projection);
  }

  get(targetRef: string): EvolutionPerformanceProjection | undefined {
    return this.#values.get(targetRef);
  }

  list(): readonly EvolutionPerformanceProjection[] {
    return sortedProjections(this.#values);
  }
}
