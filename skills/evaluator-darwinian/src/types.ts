import type { OptimizationEngineShape } from "../../../src/learning/evolution/types";

export interface DarwinianClientConfig {
  readonly endpoint: string;
  readonly fetch: typeof globalThis.fetch;
}

export interface DarwinianEngineClient {
  readonly engine: OptimizationEngineShape;
}
