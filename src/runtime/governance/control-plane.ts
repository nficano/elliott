import { timingSafeEqual } from "node:crypto";
import { isJsonRecord } from "../../providers/http";
import {
  HTTP_BAD_REQUEST,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "../http";
import type { ToolGovernor } from "./governor";
import type {
  GovernanceControlPlaneBinding,
  GovernanceOperation,
} from "./types";

const CONTROL_ACTOR = "control-plane";

const safeTokenEqual = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length
    && timingSafeEqual(providedBytes, expectedBytes);
};

const authorized = (request: Request, token: string): boolean => {
  const authorization = request.headers.get("authorization");
  return authorization !== null
    && safeTokenEqual(authorization, `Bearer ${token}`);
};

const errorResponse = (status: number, message: string): Response =>
  Response.json({ error: message }, { status });

const statusResponse = (governor: ToolGovernor): Response =>
  Response.json(governor.status(), { status: HTTP_OK });

// Pure parse of the POST body into a governance operation. Precedence mirrors
// the original: freeze, unfreeze, then a tool-scoped disable/enable, else an
// invalid verdict carrying the operator-facing message. A non-record body is
// rejected with the same message the shell used for a malformed request.
export const parseGovernanceOperation = (
  body: unknown,
): GovernanceOperation => {
  if (!isJsonRecord(body)) {
    return { kind: "invalid", reason: "Invalid request body" };
  }
  const op = body["op"];
  if (op === "freeze") return { kind: "freeze" };
  if (op === "unfreeze") return { kind: "unfreeze" };
  const tool = body["tool"];
  if (typeof tool === "string" && op === "disable") {
    return { kind: "disable", tool };
  }
  if (typeof tool === "string" && op === "enable") {
    return { kind: "enable", tool };
  }
  return { kind: "invalid", reason: "Invalid governance operation" };
};

const applyOperation = async (
  governor: ToolGovernor,
  operation: GovernanceOperation,
): Promise<Response> => {
  switch (operation.kind) {
    case "freeze": {
      await governor.freeze(CONTROL_ACTOR);
      return statusResponse(governor);
    }
    case "unfreeze": {
      await governor.unfreeze(CONTROL_ACTOR);
      return statusResponse(governor);
    }
    case "disable": {
      await governor.disable(operation.tool, CONTROL_ACTOR);
      return statusResponse(governor);
    }
    case "enable": {
      await governor.enable(operation.tool, CONTROL_ACTOR);
      return statusResponse(governor);
    }
    case "invalid": {
      return errorResponse(HTTP_BAD_REQUEST, operation.reason);
    }
  }
};

// Bearer-guarded runtime kill switch. GET returns the current freeze/disabled
// set; POST {op:"disable"|"enable", tool} or {op:"freeze"|"unfreeze"} flips a
// tool (or the whole runtime) off without a restart — the toolkit's Agent-SRE
// control adapted to elliott's single-token control-plane convention. Every
// toggle is written to the same tamper-evident audit trail as tool calls.
export const makeGovernanceControlPlane = (
  governor: ToolGovernor,
  token: string,
): GovernanceControlPlaneBinding => ({
  handle: async (request: Request) => {
    if (!authorized(request, token)) {
      return errorResponse(HTTP_UNAUTHORIZED, "Not authorized");
    }
    if (request.method === "GET") return statusResponse(governor);
    if (request.method !== "POST") {
      return errorResponse(HTTP_METHOD_NOT_ALLOWED, "Method not allowed");
    }
    try {
      const operation = parseGovernanceOperation(await request.json());
      return await applyOperation(governor, operation);
    } catch {
      return errorResponse(HTTP_BAD_REQUEST, "Invalid request body");
    }
  },
});
