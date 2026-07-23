import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpError } from "../errors.js";
import { makeHttpWire } from "./http.js";
import { McpCallResultSchema, McpToolsListSchema } from "./schema.js";
import { makeSseWire } from "./sse.js";
import type {
  McpClient,
  McpClientDeps,
  McpServerConfig,
  McpToolInfo,
  McpWire,
} from "./types.js";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "agent-kit", version: "0.1.0" };

/**
 * The MCP client (§7.5) on top of a wire: initialize handshake, tool
 * discovery (cursor-paginated), and calls whose text content becomes the
 * tool result string. Transport comes from config; tests inject `deps.wire`.
 */
export function makeMcpClient(
  cfg: McpServerConfig,
  deps: McpClientDeps = {},
): McpClient {
  const wire = deps.wire ?? productionWire(cfg, deps);
  let connected = false;
  return {
    id: cfg.id,
    get connected() {
      return connected;
    },
    connect: () =>
      Effect.tryPromise({
        try: async () => {
          const tools = await handshake(wire);
          connected = true;
          return tools;
        },
        catch: (cause) =>
          new McpError({
            message: describe(cause),
            phase: "connect",
            cause,
          }),
      }),
    call: (name, args) =>
      Effect.tryPromise({
        try: () => callTool(wire, { name, args }),
        catch: (cause) =>
          new McpError({ message: describe(cause), phase: "call", cause }),
      }),
    close: async () => {
      connected = false;
      await wire.close();
    },
  };
}

/** initialize → notifications/initialized → paginated tools/list. */
async function handshake(wire: McpWire): Promise<McpToolInfo[]> {
  await wire.start();
  await wire.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  await wire.notify("notifications/initialized");
  return listAllTools(wire);
}

/** tools/call; text parts joined; isError → thrown carrying that text. */
async function callTool(
  wire: McpWire,
  input: { readonly name: string; readonly args: unknown; },
): Promise<string> {
  const raw = await wire.request("tools/call", {
    name: input.name,
    arguments: input.args ?? {},
  });
  const result = Schema.decodeUnknownSync(McpCallResultSchema)(raw ?? {});
  const text = (result.content ?? [])
    .flatMap((part) => (part.text === undefined ? [] : [part.text]))
    .join("\n");
  if (result.isError) {
    throw new Error(text || `tool ${input.name} reported an error`);
  }
  if (text.length > 0) return text;
  return result.structuredContent === undefined
    ? "ok"
    : JSON.stringify(result.structuredContent);
}

function productionWire(cfg: McpServerConfig, deps: McpClientDeps): McpWire {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (cfg.transport === "sse") return makeSseWire(cfg, fetchImpl);
  if (cfg.transport === "streamable-http") return makeHttpWire(cfg, fetchImpl);
  throw new McpError({
    message: `mcp ${cfg.id}: transport '${cfg.transport}' is not implemented`,
    phase: "connect",
  });
}

async function listAllTools(wire: McpWire): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const raw = await wire.request(
      "tools/list",
      cursor === undefined ? undefined : { cursor },
    );
    const page = Schema.decodeUnknownSync(McpToolsListSchema)(raw ?? {});
    for (const tool of page.tools) {
      tools.push({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown> | undefined)
          ?? { type: "object", properties: {} },
        readOnly: tool.annotations?.readOnlyHint === true,
      });
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
