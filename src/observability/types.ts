export interface PromptFootprint {
  readonly stablePrefixTokens: number;
  readonly skillCatalogTokens: number;
  readonly activatedSkillTokens: number;
  readonly toolSchemaTokens: number;
  readonly evidenceTokens: number;
}

export interface InferenceFootprint {
  readonly activity: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
}

export interface RuntimeFootprint {
  readonly poolContainerCount: number;
  readonly poolResidencyMb: number;
  readonly memoryBySecurityContext: Readonly<Record<string, number>>;
  readonly epochTableBytes: number;
  readonly routeTableBytes: number;
}

export interface FootprintReport {
  readonly prompt: PromptFootprint;
  readonly inference: readonly InferenceFootprint[];
  readonly runtime: RuntimeFootprint;
}

export interface FootprintBudget {
  readonly metric: string;
  readonly baseline: number;
  readonly current: number;
  readonly maximumRegressionRatio: number;
}

export interface FootprintBudgetResult {
  readonly passed: boolean;
  readonly regressionRatio: number;
  readonly budget: FootprintBudget;
}
