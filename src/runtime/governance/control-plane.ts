import { timingSafeEqual } from "node:crypto";
import { isJsonRecord } from "../../providers/http";
import {
  HTTP_BAD_REQUEST,
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_UNAUTHORIZED,
} from "../http";
import type { ToolGovernor } from "./governor";
import type { GovernanceControlPlaneBinding } from "./types";

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

const applyOperation = async (
  governor: ToolGovernor,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const op = body["op"];
  if (op === "freeze") {
    await governor.freeze(CONTROL_ACTOR);
    return statusResponse(governor);
  }
  if (op === "unfreeze") {
    await governor.unfreeze(CONTROL_ACTOR);
    return statusResponse(governor);
  }
  const tool = body["tool"];
  if (typeof tool === "string" && (op === "disable" || op === "enable")) {
    await (op === "disable"
      ? governor.disable(tool, CONTROL_ACTOR)
      : governor.enable(tool, CONTROL_ACTOR));
    return statusResponse(governor);
  }
  return errorResponse(HTTP_BAD_REQUEST, "Invalid governance operation");
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
      const body: unknown = await request.json();
      if (!isJsonRecord(body)) {
        return errorResponse(HTTP_BAD_REQUEST, "Invalid request body");
      }
      return await applyOperation(governor, body);
    } catch {
      return errorResponse(HTTP_BAD_REQUEST, "Invalid request body");
    }
  },
});
