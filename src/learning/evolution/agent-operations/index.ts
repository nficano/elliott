import { objectSchema, requiredString } from "../../../runtime/skills/http";
import type { ToolDefinition } from "../../../runtime/types";
import type {
  EvolutionAgentBackend,
  EvolutionAgentOperationDefinition,
  EvolutionAgentOperations,
} from "./types";

const operation = (
  definition: EvolutionAgentOperationDefinition,
): ToolDefinition => ({
  name: definition.name,
  description: definition.description,
  inputSchema: objectSchema(definition.properties, definition.required),
  execute: definition.execute,
});

const agentTools = (
  backend: EvolutionAgentBackend,
): readonly ToolDefinition[] => [
  operation({
    name: "evolution_inspect_target",
    description: "Inspect one evolvable target and its immutable policy.",
    properties: { target_ref: { type: "string" } },
    required: ["target_ref"],
    execute: async (input) =>
      JSON.stringify(
        await backend.inspectTarget(requiredString(input, "target_ref")),
      ),
  }),
  operation({
    name: "evolution_request_run",
    description: "Request an optimization run. This never deploys changes.",
    properties: { target_ref: { type: "string" } },
    required: ["target_ref"],
    execute: async (input) =>
      JSON.stringify(
        await backend.requestRun(requiredString(input, "target_ref")),
      ),
  }),
  operation({
    name: "evolution_get_status",
    description: "Read the durable state of one evolution run.",
    properties: { run_id: { type: "string" } },
    required: ["run_id"],
    execute: async (input) =>
      JSON.stringify(await backend.getStatus(requiredString(input, "run_id"))),
  }),
  operation({
    name: "evolution_request_proposal",
    description: "Author a review-ready Proposal for a passing candidate.",
    properties: {
      run_id: { type: "string" },
      candidate_id: { type: "string" },
    },
    required: ["run_id", "candidate_id"],
    execute: async (input) =>
      JSON.stringify(
        await backend.requestProposal(
          requiredString(input, "run_id"),
          requiredString(input, "candidate_id"),
        ),
      ),
  }),
];

export const makeEvolutionAgentOperations = (
  backend: EvolutionAgentBackend,
): EvolutionAgentOperations => ({
  tools: agentTools(backend),
  mayApprove: false,
  mayPromote: false,
  mayRollback: false,
});

export type * from "./types";
