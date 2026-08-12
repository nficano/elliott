import { isJsonRecord } from "../../../src/providers/http";
import type { McpEndpointSettings } from "../../../src/runtime/types";
import { parseSseText } from "./sse";
import type { RpcWire } from "./types";

const MCP_SESSION_HEADER = "mcp-session-id";
const HTTP_ACCEPTED = 202;
const HTTP_NO_CONTENT = 204;

export const makeHttpWire = (settings: McpEndpointSettings): RpcWire => {
  let sessionId: string | undefined;
  let nextId = 1;
  const post = async (payload: Readonly<Record<string, unknown>>) => {
    const response = await fetch(settings.url, {
      method: "POST",
      headers: requestHeaders(settings, sessionId),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`MCP ${settings.id} returned HTTP ${response.status}`);
    }
    sessionId = response.headers.get(MCP_SESSION_HEADER) ?? sessionId;
    return response;
  };
  return {
    start: async () => undefined,
    request: async (method, params) => {
      const id = nextId++;
      const response = await post({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      });
      return unwrapRpc(await responsePayload(response), settings.id, method);
    },
    notify: async (method) => {
      const response = await post({ jsonrpc: "2.0", method });
      await response.body?.cancel();
    },
    close: async () => undefined,
  };
};

const requestHeaders = (
  settings: McpEndpointSettings,
  sessionId: string | undefined,
): Record<string, string> => ({
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  ...(settings.authorization !== undefined
    && { authorization: `Bearer ${settings.authorization}` }),
  ...(sessionId !== undefined && { [MCP_SESSION_HEADER]: sessionId }),
});

const responsePayload = async (response: Response): Promise<unknown> => {
  if (
    response.status === HTTP_ACCEPTED || response.status === HTTP_NO_CONTENT
  ) {
    return {};
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return response.json();
  for (const event of parseSseText(await response.text())) {
    try {
      const value: unknown = JSON.parse(event.data);
      return value;
    } catch {
      continue;
    }
  }
  throw new Error("MCP response did not contain a JSON-RPC frame");
};

export const unwrapRpc = (
  payload: unknown,
  endpoint: string,
  method: string,
): unknown => {
  if (!isJsonRecord(payload)) {
    throw new Error(`MCP ${endpoint} sent a non-object response`);
  }
  const error = payload["error"];
  if (isJsonRecord(error)) {
    const code = String(error["code"]);
    const message = String(error["message"]);
    throw new Error(`MCP ${endpoint} ${method} failed (${code}): ${message}`);
  }
  return payload["result"];
};
