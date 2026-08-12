import { isJsonRecord } from "../../../src/providers/http";
import type {
  McpEndpointSettings,
  ToolDefinition,
} from "../../../src/runtime/types";
import { makeHttpWire } from "./http";
import { makeSseWire } from "./sse";
import type { McpConnection, McpToolInfo, RpcWire } from "./types";

const PROTOCOL_VERSION = "2025-06-18";

export const connectMcp = async (
  settings: McpEndpointSettings,
): Promise<McpConnection> => {
  const wire = settings.transport === "sse"
    ? makeSseWire(settings)
    : makeHttpWire(settings);
  await wire.start();
  await wire.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "elliott", version: "1.0.0" },
  });
  await wire.notify("notifications/initialized");
  const tools = await listTools(wire);
  return {
    settings,
    tools,
    definitions: () => tools.map((tool) => definition(settings, wire, tool)),
    close: () => wire.close(),
  };
};

const listTools = async (wire: RpcWire): Promise<readonly McpToolInfo[]> => {
  const output: McpToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const value = await wire.request(
      "tools/list",
      cursor === undefined ? undefined : { cursor },
    );
    if (!isJsonRecord(value) || !Array.isArray(value["tools"])) {
      throw new Error("MCP tools/list returned an invalid catalog");
    }
    for (const item of value["tools"]) {
      const tool = decodeTool(item);
      if (tool !== undefined) output.push(tool);
    }
    cursor = typeof value["nextCursor"] === "string"
      ? value["nextCursor"]
      : undefined;
  } while (cursor !== undefined);
  return output;
};

const decodeTool = (value: unknown): McpToolInfo | undefined => {
  if (!isJsonRecord(value) || typeof value["name"] !== "string") return;
  const schema = value["inputSchema"];
  return {
    name: value["name"],
    description: typeof value["description"] === "string"
      ? value["description"]
      : `MCP tool ${value["name"]}`,
    inputSchema: isJsonRecord(schema)
      ? schema
      : { type: "object", properties: {} },
  };
};

const definition = (
  settings: McpEndpointSettings,
  wire: RpcWire,
  tool: McpToolInfo,
): ToolDefinition => ({
  name: modelToolName(settings.id, tool.name),
  description: `[${settings.id}] ${tool.description}`,
  inputSchema: tool.inputSchema,
  execute: async (input) => {
    const result = await wire.request("tools/call", {
      name: tool.name,
      arguments: input,
    });
    return toolResult(result);
  },
});

const modelToolName = (endpoint: string, tool: string): string =>
  `mcp_${endpoint}_${tool}`.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

const toolResult = (value: unknown): string => {
  if (!isJsonRecord(value)) return JSON.stringify(value);
  const content = value["content"];
  if (!Array.isArray(content)) return JSON.stringify(value);
  const text = content.flatMap((item) =>
    isJsonRecord(item) && typeof item["text"] === "string"
      ? [item["text"]]
      : []
  ).join("\n");
  if (value["isError"] === true) throw new Error(text || "MCP tool failed");
  return text.length > 0 ? text : JSON.stringify(value["structuredContent"]);
};
