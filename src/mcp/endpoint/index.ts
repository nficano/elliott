import { componentRef, snapshotId } from "../../core/brands";
import { hashValue, newId } from "../../core/digest";
import type {
  McpArtifact,
  McpEndpointConfig,
  McpEndpointSnapshot,
  McpInvocationRequest,
  McpInvocationResult,
  McpProtocolDriver,
  McpVirtualChild,
} from "../types";

const childKind = (
  artifact: McpArtifact,
): McpVirtualChild["kind"] =>
  artifact.kind === "prompt"
    ? "prompt-source"
    : artifact.kind;

const validateArtifact = (artifact: McpArtifact): void => {
  if (artifact.name.length === 0 || artifact.name.includes(".")) {
    throw new Error("MCP artifact names must be non-empty and unqualified");
  }
  if (artifact.inputSchema["type"] !== "object") {
    throw new Error(
      `MCP artifact ${artifact.name} has an invalid input schema`,
    );
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const containsToken = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsToken);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    key.toLowerCase().includes("token")
    || key.toLowerCase() === "authorization"
    || containsToken(child)
  );
};

export class McpEndpoint {
  readonly #config: McpEndpointConfig;
  readonly #driver: McpProtocolDriver;
  #active?: McpEndpointSnapshot;

  constructor(config: McpEndpointConfig, driver: McpProtocolDriver) {
    this.#config = config;
    this.#driver = driver;
  }

  get active(): McpEndpointSnapshot | undefined {
    return this.#active;
  }

  async connect(): Promise<McpEndpointSnapshot> {
    const discovery = await this.#driver.discover();
    for (const artifact of discovery.artifacts) validateArtifact(artifact);
    const catalogDigest = hashValue(discovery.artifacts);
    const children = Object.freeze(
      discovery.artifacts.map((artifact) => this.#virtualChild(artifact)),
    );
    const approved = this.#config.approvedCatalogDigest === catalogDigest;
    const candidate: McpEndpointSnapshot = Object.freeze({
      snapshot: snapshotId(newId("mcp-snapshot")),
      catalogDigest,
      children,
      state: approved ? "healthy" : "requires-approval",
    });
    if (approved) this.#active = candidate;
    return candidate;
  }

  approve(candidate: McpEndpointSnapshot): McpEndpointSnapshot {
    const active: McpEndpointSnapshot = Object.freeze({
      ...candidate,
      state: "healthy",
    });
    this.#active = active;
    return active;
  }

  async invoke(request: McpInvocationRequest): Promise<McpInvocationResult> {
    const active = this.#active;
    if (active === undefined || active.state !== "healthy") {
      throw new Error("MCP endpoint catalog is not approved");
    }
    if (active.children.every((child) => child.name !== request.artifact)) {
      throw new Error(
        `MCP artifact ${request.artifact} is not in the active snapshot`,
      );
    }
    if (containsToken(request.input)) {
      throw new Error("MCP token passthrough is prohibited");
    }
    const response = await this.#driver.invoke(request);
    return {
      content: Object.freeze({
        id: newId("mcp-response"),
        principal: this.#config.principal,
        actorTrust: "asserted",
        contentTrust: "untrusted",
        classification: this.#config.classification,
        securityTags: Object.freeze([{
          source: this.#config.ref,
          classification: this.#config.classification,
          reason: "external-mcp-response",
        }]),
        payload: response.content,
        createdAt: new Date().toISOString(),
      }),
    };
  }

  #virtualChild(artifact: McpArtifact): McpVirtualChild {
    const endpointName = this.#config.ref.split("/").at(-1) ?? this.#config.ref;
    const prefix = artifact.kind === "prompt" ? "prompt" : artifact.kind;
    return Object.freeze({
      ref: `mcp.${endpointName}.${prefix}.${artifact.name}`,
      endpoint: componentRef(this.#config.ref),
      name: artifact.name,
      kind: childKind(artifact),
      description: artifact.description,
      inputSchema: artifact.inputSchema,
    });
  }
}
