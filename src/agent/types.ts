import type {
  CapabilityRequest,
  ComponentManifest,
  ComponentRef,
} from "../core/types";
import type { ReservedProfile } from "../model/types";

export interface AgentModelComposition {
  readonly defaultProfile: ReservedProfile;
  readonly maximumProfile: ReservedProfile;
}

export interface AgentMemoryComposition {
  readonly curated: ComponentRef;
  readonly sessions: ComponentRef;
  readonly external?: ComponentRef;
}

export interface AgentComposition {
  readonly ref: ComponentRef;
  readonly interactionProfile: ComponentRef;
  readonly models: AgentModelComposition;
  readonly skills: readonly ComponentRef[];
  readonly memory: AgentMemoryComposition;
  readonly gateways: readonly ComponentRef[];
  readonly mcp: readonly ComponentRef[];
  readonly policies: readonly ComponentRef[];
  readonly evaluators: readonly ComponentRef[];
  readonly capabilityCeiling: readonly string[];
  readonly learning: { readonly mode: "proposals"; readonly autoApply: false; };
}

export interface ComposedAgentChild {
  readonly manifest: ComponentManifest;
  readonly effectiveCapabilities: readonly CapabilityRequest[];
}

export interface ComposedAgent {
  readonly config: AgentComposition;
  readonly children: readonly ComposedAgentChild[];
  readonly loop: "default";
}

export interface AgentComponentResolver {
  resolveManifest(ref: ComponentRef): ComponentManifest | undefined;
}

export interface ConsumerScaffoldRequest {
  readonly name: string;
  readonly parentDirectory: string;
}

export interface ConsumerScaffoldResult {
  readonly directory: string;
  readonly files: readonly string[];
}
