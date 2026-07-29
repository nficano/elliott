import { makeHttpTrustedCodeChecker } from "../../../../src/learning/evolution/application/code-checker";
import type { EvolutionIndependentEvaluatorShape } from "../../../../src/learning/evolution/application/types";
import { makeHttpEvolutionBenchmarkRunner } from "../../../../src/learning/evolution/benchmarks/http";
import { makeHttpIndependentEvaluator } from "../../../../src/learning/evolution/evaluation/http";
import type { EvolutionTrustedCodeCheckerShape } from "../../../../src/learning/evolution/orchestrator/types";
import type { EvolutionBenchmarkRunnerShape } from "../../../../src/learning/evolution/types";
import type { SkillRegistration } from "../../../../src/runtime/skills/types";
import type { BenchmarkClientConfig } from "./types";

export const createBenchmarkClient = (
  config: BenchmarkClientConfig,
): EvolutionBenchmarkRunnerShape =>
  makeHttpEvolutionBenchmarkRunner(config.endpoint, config.fetch);

export const createIndependentEvaluationClient = (
  config: BenchmarkClientConfig,
): EvolutionIndependentEvaluatorShape =>
  makeHttpIndependentEvaluator({
    endpoint: config.endpoint,
    fetch: config.fetch,
  });

export const createCodeCheckClient = (
  config: BenchmarkClientConfig,
): EvolutionTrustedCodeCheckerShape =>
  makeHttpTrustedCodeChecker(config.endpoint, config.fetch);

export const register = (): SkillRegistration => ({});
