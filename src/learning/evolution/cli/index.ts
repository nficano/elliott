import { isJsonRecord } from "../../../providers/http";
import type {
  EvolutionCliBackend,
  EvolutionCliOperation,
  EvolutionCliRequest,
} from "./types";

const DATASET_COMMAND_WORDS = 3;
const DEFAULT_COMMAND_WORDS = 2;
const SIMPLE_EVOLUTION_OPERATIONS = new Map<string, EvolutionCliOperation>([
  ["run", "evolution.run"],
  ["status", "evolution.status"],
  ["pause", "evolution.pause"],
  ["resume", "evolution.resume"],
  ["cancel", "evolution.cancel"],
  ["compare", "evolution.compare"],
  ["propose", "evolution.propose"],
]);

const evolutionOperation = (
  action: string | undefined,
  subaction: string | undefined,
): EvolutionCliOperation | undefined => {
  if (action === "inspect") return "evolution.inspect";
  if (action === "dataset" && subaction === "build") {
    return "evolution.dataset.build";
  }
  return action === undefined
    ? undefined
    : SIMPLE_EVOLUTION_OPERATIONS.get(action);
};

const operationFor = (
  arguments_: readonly string[],
): EvolutionCliOperation | undefined => {
  const [domain, action, subaction] = arguments_;
  if (domain === "evolve") return evolutionOperation(action, subaction);
  if (domain === "proposal") {
    if (action === "review" || action === "approve" || action === "reject") {
      return `proposal.${action}`;
    }
    return undefined;
  }
  return domain === "release"
      && (action === "promote" || action === "rollback")
    ? `release.${action}`
    : undefined;
};

const consumedWords = (operation: EvolutionCliOperation): number =>
  operation === "evolution.dataset.build"
    ? DATASET_COMMAND_WORDS
    : DEFAULT_COMMAND_WORDS;

export const parseEvolutionCliRequest = (
  arguments_: readonly string[],
): EvolutionCliRequest => {
  const operation = operationFor(arguments_);
  if (operation === undefined) {
    throw new Error("Unknown evolution, Proposal, or release command");
  }
  const remaining = arguments_.slice(consumedWords(operation));
  if (remaining.length === 0) {
    throw new Error(
      `${operation} requires a target, run, Proposal, or release`,
    );
  }
  return { operation, arguments: remaining };
};

export const executeEvolutionCli = async (
  arguments_: readonly string[],
  backend: EvolutionCliBackend,
): Promise<string> => {
  const result = await backend.execute(parseEvolutionCliRequest(arguments_));
  return JSON.stringify(result, undefined, 2);
};

export const makeHttpEvolutionCliBackend = (
  endpoint: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  authorization?: string,
): EvolutionCliBackend => ({
  execute: async (request) => {
    const response = await fetchImplementation(
      new URL("/v1/control/evolution", endpoint),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization !== undefined && { authorization }),
        },
        body: JSON.stringify(request),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Evolution control plane returned HTTP ${response.status}`,
      );
    }
    const value: unknown = await response.json();
    if (!isJsonRecord(value)) {
      throw new TypeError("Evolution control plane returned invalid JSON");
    }
    return value;
  },
});

export * from "./control-plane";
export type * from "./types";
