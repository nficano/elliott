import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";
import { EvolutionBenchmarkResult } from "../model/index";
import { EvolutionTargetClassSchema } from "../model/index";
import type { EvolutionCandidate } from "../model/index";
import { PROMPT_INJECTION_PATTERNS } from "./prompt-injection-corpus";
import type { EvolutionBenchmarkStage, PromptInjectionScan } from "./types";

const BENCHMARK_REF = "core/evaluator/prompt-injection";
const CLEAN_SCORE = 1;
const DIRTY_SCORE = 0;

const reportDigest = (detail: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(detail)).digest("hex")}`;

// Pure, deterministic scan for injection/safety-bypass signatures in artifact
// text. Linear in the content length; no model call, no network.
export const scanForInjection = (content: string): PromptInjectionScan => {
  const lowered = content.toLowerCase();
  const matches = PROMPT_INJECTION_PATTERNS
    .filter((pattern) => pattern.matcher.test(lowered))
    .map((pattern) => pattern.id);
  return { clean: matches.length === 0, matches };
};

const notApplicable = (
  candidate: EvolutionCandidate,
): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: BENCHMARK_REF,
    scope: "candidate",
    baselineScore: CLEAN_SCORE,
    candidateScore: CLEAN_SCORE,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 0,
    reportDigest: reportDigest({
      candidate: candidate.candidateDigest,
      scanned: false,
    }),
    status: "not-applicable",
    reason: "candidate has no materialized content to scan",
    passed: true,
  });

const scored = (
  candidate: EvolutionCandidate,
  scan: PromptInjectionScan,
): EvolutionBenchmarkResult =>
  EvolutionBenchmarkResult.make({
    benchmarkRef: BENCHMARK_REF,
    scope: "candidate",
    baselineScore: CLEAN_SCORE,
    candidateScore: scan.clean ? CLEAN_SCORE : DIRTY_SCORE,
    maximumRegressionRatio: 0,
    costUsd: 0,
    latencyMilliseconds: 0,
    reportDigest: reportDigest({
      candidate: candidate.candidateDigest,
      matches: scan.matches,
    }),
    status: scan.clean ? "passed" : "failed",
    ...(!scan.clean && {
      reason: `prompt-injection signatures present: ${scan.matches.join(", ")}`,
    }),
    passed: scan.clean,
  });

// Native scorer: inspects the candidate's evolved artifact for injection/bypass
// content. A candidate with no materialized content is not-applicable (pass);
// otherwise it fails iff any signature matches.
export const scorePromptInjection = (
  candidate: EvolutionCandidate,
): EvolutionBenchmarkResult => {
  const content = candidate.materializedContent;
  return content === undefined
    ? notApplicable(candidate)
    : scored(candidate, scanForInjection(content));
};

// A cheap, native, non-companion benchmark stage. Prepend it to a ladder so it
// short-circuits promotion before the expensive HTTP-delegated benchmarks run.
export const makePromptInjectionStage = (
  targetClass: typeof EvolutionTargetClassSchema.Type,
): EvolutionBenchmarkStage => {
  const applicable = EvolutionTargetClassSchema.literals.includes(targetClass);
  return {
    benchmarkRef: BENCHMARK_REF,
    applicable,
    ...(!applicable && {
      notApplicableReason: `prompt-injection does not apply to ${targetClass}`,
    }),
    run: (_run, candidate) => Effect.succeed(scorePromptInjection(candidate)),
  };
};
