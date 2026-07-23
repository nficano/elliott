import type { ToolDef } from "../core/agent/types.js";
import type { Usage } from "../core/types.js";
import type { AgentKitConfig } from "../host/config/schema.js";
import type { Registrable } from "../host/registry/types.js";

export interface GoldenItem {
  readonly id: string;
  readonly input: string;
  readonly expected?: string;
}

export interface RunMetrics {
  readonly id: string;
  readonly output: string;
  readonly ttftMs: number;
  readonly totalMs: number;
  readonly usage: Usage;
  readonly costUsd: number;
  readonly quality?: number; // 0..1 from an LLM-judge (supplied by the consumer)
}

export type RunFn = (input: string) => Promise<Omit<RunMetrics, "id">>;

export interface RunDelta {
  readonly dP50Ms: number;
  readonly dP95Ms: number;
  readonly dTotalMs: number;
  readonly dCostUsd: number;
  readonly dQuality: number;
}

export interface FootprintGateOptions {
  readonly config: AgentKitConfig;
  readonly registrables: Registrable[];
  readonly coreTools?: ToolDef[];
  readonly bundleOrder?: string[];
}

export interface SchemaLint {
  readonly tool: string;
  readonly issue: string;
}

export interface FootprintGateReport {
  readonly pass: boolean;
  readonly coldTokensMax: number;
  readonly coreColdTokens: number;
  readonly perBundle: { bundle: string; coldTokens: number; tools: number; }[];
  /** Worst-case exposed = core + the 3 largest bundles (§10.1 cap). */
  readonly worstCaseExposed: number;
  readonly budgetViolations: string[];
  readonly schemaLints: SchemaLint[];
}
