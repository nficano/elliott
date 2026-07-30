// Core ontology and object model — TDD §7.3, §7.4.

import type * as Brand from "effect/Brand";

export type ComponentKind =
  | "agent"
  | "skill"
  | "tool"
  | "resource"
  | "gateway"
  | "mcp-endpoint"
  | "mcp-exposure"
  | "extension"
  | "interaction-profile"
  | "memory"
  | "policy"
  | "evaluator"
  | "model-provider"
  | "model-profile"
  | "scheduler";

/** Kinds that participate in security decisions. Subject to org pinning (§7.5)
 *  and elevated isolation minimums (§7.4a). */
export type SecurityCriticalKind =
  | "policy"
  | "evaluator"
  | "gateway"
  | "model-provider";

export type IsolationLevel =
  | "declarative"
  | "in-process"
  | "process"
  | "container"
  | "remote";

/** Monotonic counters owned by the kernel. See §7.2d and §7.3a. */
export type Epoch = Brand.Branded<number, "Epoch">;

export interface EpochVector {
  readonly org: Epoch;
  readonly workspace: Epoch;
  readonly agent: Epoch;
  readonly session: Epoch;
  readonly principal: Epoch;
}

export type Digest = Brand.Branded<string, "Digest">;
export type ComponentRef = Brand.Branded<string, "ComponentRef">;
export type ProtocolId = Brand.Branded<string, "ProtocolId">;
export type PrincipalId = Brand.Branded<string, "PrincipalId">;
export type SnapshotId = Brand.Branded<string, "SnapshotId">;
export type ScopeId = Brand.Branded<string, "ScopeId">;
export type GrantHandle = Brand.Branded<string, "GrantHandle">;
export type PlacementRef = Brand.Branded<string, "PlacementRef">;

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export type ScopeLevel =
  | "invocation"
  | "principal"
  | "session"
  | "agent"
  | "workspace"
  | "user"
  | "organization"
  | "builtin";

export interface Scope {
  readonly level: ScopeLevel;
  readonly id: ScopeId;
}

/** Placeholder until the runtime schema adapter is chosen (TDD Q-02, §16). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ProtocolDescriptor {
  readonly id: ProtocolId;
  readonly schema: JsonSchema;
}

export interface CapabilityRequest {
  readonly capability: string;
  readonly resources: readonly string[];
  /** JIT operator approval on first use — least-privilege pressure, §7.3. */
  readonly deferred?: boolean;
}

export interface ResourceLimitRequest {
  readonly maxConcurrency?: number;
  readonly cpuQuota?: number;
  readonly memoryMb?: number;
  readonly pids?: number;
  readonly ioBytesPerSecond?: number;
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
}

export interface Provenance {
  readonly source: string;
  readonly digest: Digest;
  readonly signature?: string;
}

export interface ComponentSchema {
  readonly kind: ComponentKind;
  readonly apiVersion: string;
  readonly digest: Digest;
  readonly documentName: string;
  readonly manifestSchema: JsonSchema;
  /** Floor, not default. The kernel refuses instantiation below this level. */
  readonly minimumIsolation: IsolationLevel;
}

export interface SchemaRef {
  readonly kind: ComponentKind;
  readonly apiVersion: string;
  readonly digest: Digest;
}

export interface ComponentManifest {
  readonly ref: ComponentRef;
  /** Reference, not embedded schema. Two manifests of the same kind cannot
   *  disagree about their own schema; the registry resolves the ref once. */
  readonly schema: SchemaRef;
  readonly version: string;
  readonly digest: Digest;
  readonly description: string;
  readonly protocols: readonly ProtocolDescriptor[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly requestedLimits: ResourceLimitRequest;
  readonly provenance: Provenance;
}

export type LifecycleState =
  | "created"
  | "opening"
  | "open"
  | "draining"
  | "closed"
  | "failed";

export interface ComponentTransport {
  /** Wire transport and RPC framing are separate layers. */
  readonly wire: "unix-socket" | "tcp" | "websocket";
  readonly framing: "grpc" | "trpc";
  readonly endpoint: string;
}

export interface ComponentInstance {
  readonly manifest: ComponentManifest;
  readonly scope: Scope;
  readonly principal: PrincipalId;
  readonly configDigest: Digest;
  readonly grants: GrantHandle;
  readonly snapshot: SnapshotId;
  readonly lifecycle: LifecycleState;
  /** Placement decided by the kernel per §7.4b; never self-selected. */
  readonly placement: PlacementRef;
  readonly transport?: ComponentTransport;
}

export type InspectionView = "model" | "operator" | "debug";

export interface ComponentInspection {
  readonly ref: ComponentRef;
  readonly kind: ComponentKind;
  readonly description: string;
  readonly protocols: readonly ProtocolId[];
  readonly view: InspectionView;
}

/** Restricted, kernel-provided context. No ambient authority (§7.2f, §7.11). */
export interface ComponentContext {
  readonly scope: Scope;
  readonly principal: PrincipalId;
  readonly snapshot: SnapshotId;
}

export interface ComponentDefinition<Config> {
  readonly manifest: ComponentManifest;
  readonly configSchema: JsonSchema;
  readonly __config?: Config;
}

export interface ComponentCreateInput<Config> {
  readonly instance: ComponentInstance;
  readonly config: Readonly<Config>;
  readonly context: ComponentContext;
}

/** Structural view of a constructed Component; the class lives in
 *  core/component/component.ts (types stay in type modules per lint policy). */
export interface ComponentLike {
  readonly instance: ComponentInstance;
  readonly manifest: ComponentManifest;
  readonly kind: ComponentKind;
  supports(protocol: ProtocolId): boolean;
}

export interface ComponentModule<Config> {
  readonly definition: ComponentDefinition<Config>;
  create(input: ComponentCreateInput<Config>): ComponentLike;
}
