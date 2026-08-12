import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { createHash } from "node:crypto";
import type { EvolutionIndependentEvaluatorShape } from "../application/types";
import {
  EvolutionBaselineReport,
  EvolutionEvaluationReport,
} from "../model/index";
import { decodeJson, encodeJson } from "../store/codec";
import {
  containedPath,
  fileExists,
  readText,
  writeTextAtomic,
} from "../store/files";
import {
  assertEvolutionBaselineReportBindings,
  assertEvolutionEvaluationReportBindings,
} from "./bindings";
import type {
  EvolutionBaselineCacheShape,
  EvolutionEvaluationCacheShape,
  EvolutionEvaluationPlan,
  EvolutionHarnessShape,
} from "./types";

export const baselineEvaluationCacheKey = (
  request: Parameters<EvolutionIndependentEvaluatorShape["baseline"]>[0],
): string =>
  createHash("sha256")
    .update(JSON.stringify({
      targetDigest: request.run.target.baselineDigest,
      datasetDigest: request.dataset.digest,
      evaluationPlanDigest: request.evaluationPlanDigest,
      environmentDigest: request.environmentDigest,
      baselineSnapshotId: request.baselineSnapshotId,
      routeDigest: request.evaluationRouteDigest,
      seed: request.seed,
    }))
    .digest("hex");

export const evolutionEvaluationCacheKey = (
  plan: Pick<
    EvolutionEvaluationPlan,
    | "candidate"
    | "dataset"
    | "evaluationPlanDigest"
    | "environmentDigest"
    | "baselineSnapshotId"
    | "candidateSnapshotId"
    | "evaluationRouteDigest"
    | "seed"
  >,
): string =>
  createHash("sha256")
    .update(JSON.stringify({
      candidateDigest: plan.candidate.candidateDigest,
      datasetDigest: plan.dataset.digest,
      evaluationPlanDigest: plan.evaluationPlanDigest,
      environmentDigest: plan.environmentDigest,
      baselineSnapshotId: plan.baselineSnapshotId,
      candidateSnapshotId: plan.candidateSnapshotId,
      routeDigest: plan.evaluationRouteDigest,
      seed: plan.seed,
    }))
    .digest("hex");

export const makeFileEvaluationCache = (
  root: string,
): EvolutionEvaluationCacheShape => ({
  get: Effect.fn("EvolutionEvaluationCache.get")(function*(key: string) {
    const filePath = yield* containedPath(
      root,
      "evaluation-cache",
      `${key}.json`,
    );
    if (!(yield* fileExists(filePath))) return Option.none();
    return yield* readText(filePath).pipe(
      Effect.flatMap((source) =>
        decodeJson(EvolutionEvaluationReport, filePath, source)
      ),
      Effect.option,
    );
  }),
  put: Effect.fn("EvolutionEvaluationCache.put")(function*(
    key: string,
    report: EvolutionEvaluationReport,
  ) {
    const filePath = yield* containedPath(
      root,
      "evaluation-cache",
      `${key}.json`,
    );
    const source = yield* encodeJson(
      EvolutionEvaluationReport,
      filePath,
      report,
    );
    yield* writeTextAtomic(filePath, source);
  }),
});

export const makeFileBaselineEvaluationCache = (
  root: string,
): EvolutionBaselineCacheShape => ({
  get: Effect.fn("EvolutionBaselineCache.get")(function*(key: string) {
    const filePath = yield* containedPath(
      root,
      "baseline-evaluation-cache",
      `${key}.json`,
    );
    if (!(yield* fileExists(filePath))) return Option.none();
    return yield* readText(filePath).pipe(
      Effect.flatMap((source) =>
        decodeJson(EvolutionBaselineReport, filePath, source)
      ),
      Effect.option,
    );
  }),
  put: Effect.fn("EvolutionBaselineCache.put")(function*(
    key: string,
    report: EvolutionBaselineReport,
  ) {
    const filePath = yield* containedPath(
      root,
      "baseline-evaluation-cache",
      `${key}.json`,
    );
    const source = yield* encodeJson(
      EvolutionBaselineReport,
      filePath,
      report,
    );
    yield* writeTextAtomic(filePath, source);
  }),
});

export const withEvaluationCache = (
  harness: EvolutionHarnessShape,
  cache: EvolutionEvaluationCacheShape,
): EvolutionHarnessShape => ({
  evaluate: (plan) => {
    const key = evolutionEvaluationCacheKey(plan);
    return cache.get(key).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            harness.evaluate(plan).pipe(
              Effect.tap((report) => cache.put(key, report)),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
  },
});

const evaluateAndCache = (
  input: {
    readonly evaluator: EvolutionIndependentEvaluatorShape;
    readonly cache: EvolutionEvaluationCacheShape;
    readonly key: string;
    readonly request: Parameters<
      EvolutionIndependentEvaluatorShape["compare"]
    >[0];
  },
) =>
  input.evaluator.compare(input.request).pipe(
    Effect.tap((report) => input.cache.put(input.key, report)),
  );

export const withIndependentEvaluatorCache = (
  evaluator: EvolutionIndependentEvaluatorShape,
  cache: EvolutionEvaluationCacheShape,
  baselineCache?: EvolutionBaselineCacheShape,
): EvolutionIndependentEvaluatorShape => ({
  baseline: (request) => {
    if (baselineCache === undefined) return evaluator.baseline(request);
    const key = baselineEvaluationCacheKey(request);
    return baselineCache.get(key).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            evaluator.baseline(request).pipe(
              Effect.tap((report) => baselineCache.put(key, report)),
            ),
          onSome: (report) =>
            assertEvolutionBaselineReportBindings(request, report).pipe(
              Effect.as(report),
              Effect.catch(() =>
                evaluator.baseline(request).pipe(
                  Effect.tap((fresh) => baselineCache.put(key, fresh)),
                )
              ),
            ),
        }),
      ),
    );
  },
  compare: (request) => {
    const key = evolutionEvaluationCacheKey(request);
    return cache.get(key).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => evaluateAndCache({ evaluator, cache, key, request }),
          onSome: (report) =>
            assertEvolutionEvaluationReportBindings(request, report).pipe(
              Effect.as(report),
              Effect.catch(() =>
                evaluateAndCache({ evaluator, cache, key, request })
              ),
            ),
        }),
      ),
    );
  },
});
