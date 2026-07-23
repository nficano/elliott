import type {
  McpDiscovery,
  McpInvocationRequest,
  McpInvocationResult,
  McpProtocolDriver,
  McpTransport,
} from "../types";

export class LegacyMcpDriver implements McpProtocolDriver {
  readonly era = "legacy";
  readonly #transport: McpTransport;

  constructor(transport: McpTransport) {
    this.#transport = transport;
  }

  discover(): Promise<McpDiscovery> {
    return this.#transport.discover(this.era);
  }

  invoke(request: McpInvocationRequest): Promise<McpInvocationResult> {
    return this.#transport.invoke(this.era, request);
  }
}
