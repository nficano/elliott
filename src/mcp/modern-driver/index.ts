import type {
  McpDiscovery,
  McpInvocationRequest,
  McpInvocationResult,
  McpProtocolDriver,
  McpTransport,
} from "../types";

export class ModernMcpDriver implements McpProtocolDriver {
  readonly era = "modern";
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
