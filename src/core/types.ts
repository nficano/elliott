// Core ontology and object model — TDD §1, §2.

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

/** Kinds that participate in security decisions. Subject to org pinning (§3)
 *  and elevated isolation minimums (§2a). */
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

/** Monotonic counters owned by the kernel. See §0d and §1a. */
export type Epoch = number & { readonly __brand: unique symbol; };

export interface EpochVector {
  readonly org: Epoch;
  readonly workspace: Epoch;
  readonly agent: Epoch;
  readonly session: Epoch;
  readonly principal: Epoch;
}

export type Digest = string & { readonly __digestBrand: unique symbol; };
export type ComponentRef = string & { readonly __refBrand: unique symbol; };
export type ProtocolId = string & { readonly __protocolBrand: unique symbol; };
export type PrincipalId = string & {
  readonly __principalBrand: unique symbol;
};
export type SnapshotId = string & { readonly __snapshotBrand: unique symbol; };
export type ScopeId = string & { readonly __scopeBrand: unique symbol; };
export type GrantHandle = string & { readonly __grantBrand: unique symbol; };
export type PlacementRef = string & {
  readonly __placementBrand: unique symbol;
};

export type ScopeLevel =
  | "invocation"
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

/** Placeholder until the runtime schema adapter is chosen (§17b). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ProtocolDescriptor {
  readonly id: ProtocolId;
  readonly schema: JsonSchema;
}

export interface CapabilityRequest {
  readonly capability: string;
  readonly resources: readonly string[];
  /** JIT operator approval on first use — least-privilege pressure, §1. */
  readonly deferred?: boolean;
}

export interface ResourceLimitRequest {
  readonly maxConcurrency?: number;
  readonly memoryMb?: number;
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
  /** Placement decided by the kernel per §2b; never self-selected. */
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

/** Restricted, kernel-provided context. No ambient authority (§0f, §9). */
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
  supports(protocol: ProtocolId): boolean;
}

export interface ComponentModule<Config> {
  readonly definition: ComponentDefinition<Config>;
  create(input: ComponentCreateInput<Config>): ComponentLike;
}
