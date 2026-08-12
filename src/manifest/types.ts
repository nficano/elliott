import type {
  CapabilityRequest,
  ComponentKind,
  ComponentRef,
  Digest,
} from "../core/types";

export interface ParsedOverlay {
  readonly raw: string;
  readonly digest: Digest;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface LoadedAgentSkill {
  readonly ref: ComponentRef;
  readonly name: string;
  readonly description: string;
  readonly markdown: string;
  readonly allowedTools: readonly string[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly overlay?: ParsedOverlay;
}

export interface LoadAgentSkillInput {
  readonly namespace: string;
  readonly markdown: string;
  readonly trustedWorkspace: boolean;
  readonly overlayRaw?: string;
}

export interface CapabilityTemplate {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly CapabilityRequest[];
}

export interface ExpandedCapabilities {
  readonly template: CapabilityTemplate;
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly manifestDigest: Digest;
}

export interface ScaffoldRequest {
  readonly kind: "skill" | "tool";
  readonly name: string;
  readonly parentDirectory: string;
}

export interface ScaffoldResult {
  readonly kind: "skill" | "tool";
  readonly directory: string;
  readonly files: readonly string[];
}

export interface OverlayIdentity {
  readonly apiVersion: string;
  readonly kind: ComponentKind;
}
