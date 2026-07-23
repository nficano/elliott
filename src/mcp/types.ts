import type {
  ComponentRef,
  DataClassification,
  Digest,
  PrincipalId,
  SnapshotId,
} from "../core/types";
import type { Envelope, RecordAppender } from "../core/waist/types";

export type McpEra = "legacy" | "modern";
export type McpArtifactKind = "tool" | "resource" | "prompt";

export interface McpArtifact {
  readonly name: string;
  readonly kind: McpArtifactKind;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpDiscovery {
  readonly artifacts: readonly McpArtifact[];
  readonly capabilities: readonly string[];
}

export interface McpInvocationRequest {
  readonly artifact: string;
  readonly input: unknown;
}

export interface McpInvocationResult {
  readonly content: unknown;
}

export interface McpProtocolDriver {
  readonly era: McpEra;
  discover(): Promise<McpDiscovery>;
  invoke(request: McpInvocationRequest): Promise<McpInvocationResult>;
}

export interface McpTransport {
  discover(era: McpEra): Promise<McpDiscovery>;
  invoke(
    era: McpEra,
    request: McpInvocationRequest,
  ): Promise<McpInvocationResult>;
}

export interface McpVirtualChild {
  readonly ref: string;
  readonly endpoint: ComponentRef;
  readonly name: string;
  readonly kind: "tool" | "resource" | "prompt-source";
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpEndpointConfig {
  readonly ref: ComponentRef;
  readonly principal: PrincipalId;
  readonly classification: DataClassification;
  readonly approvedCatalogDigest?: Digest;
  readonly allowSampling: boolean;
  readonly allowElicitation: boolean;
  readonly allowRoots: boolean;
}

export interface McpEndpointSnapshot {
  readonly snapshot: SnapshotId;
  readonly catalogDigest: Digest;
  readonly children: readonly McpVirtualChild[];
  readonly state: "healthy" | "requires-approval";
}

export interface McpBrokerCall {
  readonly principal: PrincipalId;
  readonly target: ComponentRef;
  readonly operation: string;
  readonly input: unknown;
}

export interface McpExposureBroker {
  execute(call: McpBrokerCall): Promise<Envelope>;
}

export interface McpExposureConfig {
  readonly ref: ComponentRef;
  readonly principal: PrincipalId;
  readonly classification: DataClassification;
  readonly exposed: ReadonlyMap<string, ComponentRef>;
  readonly broker: McpExposureBroker;
  readonly records: RecordAppender;
}
