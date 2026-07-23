import type { McpClient, McpServerConfig } from "../../core/mcp/types.js";
import type { McpSectionConfigSchema } from "./schema.js";

/** Decoded `mcp.<id>` config section (spec `with:` keys land here verbatim). */
export type McpSectionConfig = typeof McpSectionConfigSchema.Type;

export interface McpServerOptions {
  readonly id: string;
  readonly bundle?: string;
}

export interface McpServerDeps {
  /** Test seam: replaces makeMcpClient. */
  readonly clientFor?: (cfg: McpServerConfig) => McpClient;
}
