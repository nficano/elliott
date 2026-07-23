import * as Effect from "effect/Effect";
import type { ToolDef } from "../../core/agent/types.js";
import { ToolError } from "../../core/errors.js";
import { makeMcpClient } from "../../core/mcp/client.js";
import type { McpClient, McpToolInfo } from "../../core/mcp/types.js";
import type { Registrable } from "../registry/types.js";
import { McpSectionConfigSchema } from "./schema.js";
import type {
  McpSectionConfig,
  McpServerDeps,
  McpServerOptions,
} from "./types.js";

const DEFAULT_BUNDLE = "ops";

/**
 * One MCP server as a registrable (AGENT-SPEC `mcp:`): activation connects
 * (lazy — the registry activates on first disclosure), discovers tools, and
 * exposes them as ToolDefs named `<server>_<tool>`. Tools whose annotations
 * declare `readOnlyHint` are read tools; everything else is a write tool and
 * rides the write-registry gating. The optional `token` secret becomes a
 * bearer Authorization header (Home Assistant's MCP server auth style).
 */
export function mcpServer(
  options: McpServerOptions,
  deps: McpServerDeps = {},
): Registrable<McpSectionConfig> {
  const { id } = options;
  const clientFor = deps.clientFor ?? makeMcpClient;
  return {
    manifest: {
      id,
      kind: "mcp",
      version: "0.1.0",
      configSchema: McpSectionConfigSchema,
      bundle: options.bundle ?? DEFAULT_BUNDLE,
      trust: "write",
      secrets: [{
        name: "token",
        required: false,
        description: "bearer token for the server (Authorization header)",
      }],
    },
    async activate(ctx) {
      const cfg = ctx.config;
      const bundle = cfg.bundle ?? options.bundle ?? DEFAULT_BUNDLE;
      const token = ctx.secrets["token"];
      const client = clientFor({
        id,
        transport: cfg.transport ?? "streamable-http",
        url: cfg.url,
        ...(token && { headers: { authorization: `Bearer ${token}` } }),
      });
      const discovered = await Effect.runPromise(client.connect());
      const tools: ToolDef[] = [];
      const writeTools: ToolDef[] = [];
      for (const info of discovered) {
        const target = info.readOnly ? tools : writeTools;
        target.push(wrapTool({ id, bundle, client, info }));
      }
      return {
        tools,
        writeTools,
        stop: () => client.close(),
      };
    },
  };
}

function wrapTool(options: {
  readonly id: string;
  readonly bundle: string;
  readonly client: McpClient;
  readonly info: McpToolInfo;
}): ToolDef {
  const { id, bundle, client, info } = options;
  return {
    name: toolName(id, info.name),
    description: info.description || `${info.name} (via the ${id} MCP server)`,
    parameters: info.inputSchema,
    execute: (args) =>
      client.call(info.name, args).pipe(
        Effect.mapError(
          (error) =>
            new ToolError({ message: `${id}: ${error.message}`, cause: error }),
        ),
      ),
    meta: {
      componentId: id,
      bundle,
      core: false,
      write: !info.readOnly,
    },
  };
}

/** Model-facing tool names must be unique and [A-Za-z0-9_-]. */
function toolName(serverId: string, tool: string): string {
  return `${serverId}_${tool}`.replaceAll(/[^\w-]/g, "_");
}
