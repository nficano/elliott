import type {
  FootprintBudget,
  FootprintBudgetResult,
  FootprintReport,
  InferenceFootprint,
  PromptFootprint,
  RuntimeFootprint,
} from "./types";

const EMPTY_PROMPT: PromptFootprint = {
  stablePrefixTokens: 0,
  skillCatalogTokens: 0,
  activatedSkillTokens: 0,
  toolSchemaTokens: 0,
  evidenceTokens: 0,
};

const EMPTY_RUNTIME: RuntimeFootprint = {
  poolContainerCount: 0,
  poolResidencyMb: 0,
  memoryBySecurityContext: {},
  epochTableBytes: 0,
  routeTableBytes: 0,
};

export class FootprintRegressionError extends Error {
  constructor(public readonly result: FootprintBudgetResult) {
    super(`Footprint budget exceeded for ${result.budget.metric}`);
    this.name = "FootprintRegressionError";
  }
}

export class FootprintTracker {
  #prompt: PromptFootprint = EMPTY_PROMPT;
  #runtime: RuntimeFootprint = EMPTY_RUNTIME;
  readonly #inference: InferenceFootprint[] = [];

  recordPrompt(footprint: PromptFootprint): void {
    this.#prompt = Object.freeze({ ...footprint });
  }

  recordInference(footprint: InferenceFootprint): void {
    this.#inference.push(Object.freeze({ ...footprint }));
  }

  recordRuntime(footprint: RuntimeFootprint): void {
    this.#runtime = Object.freeze({
      ...footprint,
      memoryBySecurityContext: Object.freeze({
        ...footprint.memoryBySecurityContext,
      }),
    });
  }

  report(): FootprintReport {
    return Object.freeze({
      prompt: this.#prompt,
      inference: Object.freeze([...this.#inference]),
      runtime: this.#runtime,
    });
  }
}

export const evaluateFootprintBudget = (
  budget: FootprintBudget,
): FootprintBudgetResult => {
  let regressionRatio = (budget.current - budget.baseline) / budget.baseline;
  if (budget.baseline === 0) {
    regressionRatio = budget.current === 0 ? 0 : Infinity;
  }
  return {
    passed: regressionRatio <= budget.maximumRegressionRatio,
    regressionRatio,
    budget,
  };
};

export const enforceFootprintBudgets = (
  budgets: readonly FootprintBudget[],
): readonly FootprintBudgetResult[] =>
  budgets.map((budget) => {
    const result = evaluateFootprintBudget(budget);
    if (!result.passed) throw new FootprintRegressionError(result);
    return result;
  });

export type * from "./types";
