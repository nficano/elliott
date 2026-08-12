import { isJsonRecord } from "../../../providers/http";
import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "../../../runtime/http";
import { EvolutionAuthorityError } from "../errors";
import type {
  EvolutionCliOperation,
  EvolutionCliRequest,
  EvolutionControlAuthorityResolver,
  EvolutionControlPlaneBinding,
  EvolutionControlPlaneExecutor,
} from "./types";

const OPERATION_CAPABILITIES: Readonly<Record<EvolutionCliOperation, string>> =
  {
    "evolution.inspect": "evolution.target.read",
    "evolution.dataset.build": "evolution.dataset.build",
    "evolution.run": "evolution.engine.invoke",
    "evolution.status": "evolution.run.read",
    "evolution.pause": "evolution.run.cancel",
    "evolution.resume": "evolution.engine.invoke",
    "evolution.cancel": "evolution.run.cancel",
    "evolution.compare": "evaluation.run",
    "evolution.propose": "proposal.author",
    "proposal.review": "proposal.read",
    "proposal.approve": "proposal.approve",
    "proposal.reject": "proposal.approve",
    "release.promote": "release.promote",
    "release.rollback": "release.rollback",
  };

const OPERATIONS = new Map<string, EvolutionCliOperation>([
  ["evolution.inspect", "evolution.inspect"],
  ["evolution.dataset.build", "evolution.dataset.build"],
  ["evolution.run", "evolution.run"],
  ["evolution.status", "evolution.status"],
  ["evolution.pause", "evolution.pause"],
  ["evolution.resume", "evolution.resume"],
  ["evolution.cancel", "evolution.cancel"],
  ["evolution.compare", "evolution.compare"],
  ["evolution.propose", "evolution.propose"],
  ["proposal.review", "proposal.review"],
  ["proposal.approve", "proposal.approve"],
  ["proposal.reject", "proposal.reject"],
  ["release.promote", "release.promote"],
  ["release.rollback", "release.rollback"],
]);

const decodeOperation = (value: unknown): EvolutionCliOperation => {
  const operation = typeof value === "string"
    ? OPERATIONS.get(value)
    : undefined;
  if (operation === undefined) {
    throw new TypeError("Invalid evolution control-plane operation");
  }
  return operation;
};

const decodeArguments = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid evolution control-plane arguments");
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new TypeError("Invalid evolution control-plane argument");
    }
    output.push(item);
  }
  return output;
};

const decodeRequest = async (
  request: Request,
): Promise<EvolutionCliRequest> => {
  const value: unknown = await request.json();
  if (!isJsonRecord(value)) {
    throw new TypeError("Invalid evolution control-plane request");
  }
  return {
    operation: decodeOperation(value["operation"]),
    arguments: decodeArguments(value["arguments"]),
  };
};

const safeError = (status: number, message: string): Response =>
  Response.json({ error: message }, { status });

export const makeEvolutionControlPlane = (
  authorityResolver: EvolutionControlAuthorityResolver,
  executor: EvolutionControlPlaneExecutor,
): EvolutionControlPlaneBinding => ({
  handle: async (request) => {
    if (request.method !== "POST") {
      return safeError(HTTP_METHOD_NOT_ALLOWED, "Method not allowed");
    }
    try {
      const operation = await decodeRequest(request);
      const authority = await authorityResolver.resolve(request);
      const allowed = await authority.authorize(
        OPERATION_CAPABILITIES[operation.operation],
        operation.arguments,
      );
      if (!allowed) return safeError(HTTP_UNAUTHORIZED, "Not authorized");
      const result = await executor.execute(authority, operation);
      return Response.json({
        principalId: authority.principalId,
        snapshotId: authority.snapshotId,
        result,
      }, { status: HTTP_OK });
    } catch (error) {
      if (error instanceof EvolutionAuthorityError) {
        return safeError(HTTP_UNAUTHORIZED, "Not authorized");
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        return safeError(HTTP_BAD_REQUEST, "Invalid request");
      }
      return safeError(
        HTTP_INTERNAL_SERVER_ERROR,
        "Evolution control-plane operation failed",
      );
    }
  },
});
