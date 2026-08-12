import type { ToolDefinition } from "../../../runtime/types";

export interface EvolutionAgentBackend {
  readonly inspectTarget: (targetRef: string) => Promise<unknown>;
  readonly requestRun: (targetRef: string) => Promise<unknown>;
  readonly getStatus: (runId: string) => Promise<unknown>;
  readonly requestProposal: (
    runId: string,
    candidateId: string,
  ) => Promise<unknown>;
}

export interface EvolutionAgentOperations {
  readonly tools: readonly ToolDefinition[];
  readonly mayApprove: false;
  readonly mayPromote: false;
  readonly mayRollback: false;
}

export interface EvolutionAgentOperationDefinition {
  readonly name: string;
  readonly description: string;
  readonly properties: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly required: readonly string[];
  readonly execute: ToolDefinition["execute"];
}
