import type { OptimizationEngineShape } from "../../../src/learning/evolution/types";
import type { SkillRegistration } from "../../../src/runtime/skills/types";

export interface DspyClientConfig {
  readonly endpoint: string;
  readonly fetch: typeof globalThis.fetch;
}

export interface DspyEvaluatorModule {
  readonly register: () => SkillRegistration;
  readonly createOptimizationEngineClient: (
    config: DspyClientConfig,
  ) => OptimizationEngineShape;
}
