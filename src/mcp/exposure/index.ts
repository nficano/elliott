import { scopeId } from "../../core/brands";
import type { McpExposureConfig, McpInvocationResult } from "../types";

export class McpExposure {
  readonly #config: McpExposureConfig;

  constructor(config: McpExposureConfig) {
    this.#config = config;
  }

  async invoke(name: string, input: unknown): Promise<McpInvocationResult> {
    const target = this.#config.exposed.get(name);
    if (target === undefined) {
      throw new Error(`Unknown exposed capability ${name}`);
    }
    await this.#config.records.append({
      type: "mcp.exposure-intent",
      scope: { level: "principal", id: scopeId(this.#config.principal) },
      durability: "effect-gating",
      classification: this.#config.classification,
      payload: { exposure: this.#config.ref, target, operation: name },
    });
    const envelope = await this.#config.broker.execute({
      principal: this.#config.principal,
      target,
      operation: name,
      input,
    });
    await this.#config.records.append({
      type: "mcp.exposure-invoked",
      scope: { level: "principal", id: scopeId(this.#config.principal) },
      durability: "observational",
      classification: this.#config.classification,
      payload: { exposure: this.#config.ref, target, operation: name },
    });
    return { content: envelope };
  }
}
