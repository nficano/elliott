import * as Schema from "effect/Schema";
import { JsonRpcResponseSchema } from "./schema.js";
import { parseSseText } from "./sse.js";
import type { McpFetch, McpServerConfig, McpWire } from "./types.js";

const MCP_SESSION_HEADER = "mcp-session-id";
const HTTP_NO_CONTENT_MAX = 299;
const HTTP_ACCEPTED = 202;

/**
 * Streamable-HTTP wire (MCP 2025 spec): every rpc is one POST; the server may
 * answer as plain JSON or as a short text/event-stream body (some servers wrap
 * even unary results in SSE) — both are handled. The `initialize` response's
 * Mcp-Session-Id header, when present, rides every later request.
 */
export function makeHttpWire(
  cfg: McpServerConfig,
  fetchImpl: McpFetch,
): McpWire {
  const url = cfg.url ?? "";
  let sessionId: string | undefined;
  let nextId = 1;

  const post = async (body: Record<string, unknown>): Promise<Response> => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...cfg.headers,
        ...(sessionId && { [MCP_SESSION_HEADER]: sessionId }),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`mcp ${cfg.id}: HTTP ${res.status} from ${url}`);
    }
    sessionId = res.headers.get(MCP_SESSION_HEADER) ?? sessionId;
    return res;
  };

  return {
    async start() {}, // nothing persistent to open

    async request(method, params) {
      const id = nextId++;
      const res = await post({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      });
      return unwrapRpc(await responseJson(res, cfg.id), cfg.id, method);
    },

    async notify(method) {
      const res = await post({ jsonrpc: "2.0", method });
      await res.body?.cancel();
    },

    async close() {},
  };
}

/** JSON body directly, or the first JSON data frame of an SSE-wrapped body. */
async function responseJson(res: Response, id: string): Promise<unknown> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    if (res.status > HTTP_NO_CONTENT_MAX || res.status === HTTP_ACCEPTED) {
      return {};
    }
    return res.json();
  }
  for (const event of parseSseText(await res.text())) {
    try {
      return JSON.parse(event.data);
    } catch {
      // keep scanning; some servers emit comments/pings first
    }
  }
  throw new Error(`mcp ${id}: SSE response carried no JSON frame`);
}

/** Decode the JSON-RPC envelope; rpc errors become thrown Errors. */
export function unwrapRpc(
  payload: unknown,
  id: string,
  method: string,
): unknown {
  const rpc = Schema.decodeUnknownSync(JsonRpcResponseSchema)(payload);
  if (rpc.error !== undefined) {
    throw new Error(
      `mcp ${id}: ${method} failed (${rpc.error.code}): ${rpc.error.message}`,
    );
  }
  return rpc.result;
}
