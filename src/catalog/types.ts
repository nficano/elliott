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

export interface BundledPackage {
  readonly name: string;
  readonly kind: ComponentKind;
  readonly profile: string;
  readonly directory: string;
  readonly document: string;
  readonly protocols: readonly string[];
  readonly exports: readonly BundledExport[];
  readonly entrypoint?: string;
}
