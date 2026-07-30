import type { ComponentKind, IsolationLevel } from "../core/types";
import type { CompanionDeclaration, EgressClass } from "../placement/types";

export interface BundledComponentDescriptor {
  readonly name: string;
  readonly kind: ComponentKind;
  readonly protocols: readonly string[];
  readonly egress: EgressClass;
  readonly isolation: IsolationLevel;
  readonly secretRefs: readonly string[];
  readonly senderAllowlistRequired: boolean;
  readonly untrustedOutput: boolean;
  readonly companion?: CompanionDeclaration;
}

export interface WorkspacePathGrant {
  readonly root: string;
  readonly additionalRoots: readonly string[];
}

export interface BundledExport {
  readonly ref: string;
  readonly implementation: string;
}

// A facility this package's registration provides (manifest spec.provides).
// Packages that provide facilities register before everything else so
// consumers can acquire grants during their own register(). See
// docs/skill-facilities.md.
export interface FacilityRef {
  readonly facility: string;
  readonly version: number;
}

export interface BundledPackage {
  readonly name: string;
  readonly kind: ComponentKind;
  readonly profile: string;
  readonly directory: string;
  readonly document: string;
  readonly protocols: readonly string[];
  readonly provides: readonly FacilityRef[];
  readonly exports: readonly BundledExport[];
  readonly entrypoint?: string;
  // The manifest's spec.topology block, verbatim. The deep-trace extension
  // derives map nodes/edges from it at runtime (same semantics as
  // scripts/gen-topology.mjs), so a skill that declares one appears on the
  // map without hand-editing the served topology document.
  readonly topology?: Readonly<Record<string, unknown>>;
}
