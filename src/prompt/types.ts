import type { DataClassification, Digest, SnapshotId } from "../core/types";
import type { SecurityTagValue } from "../core/waist/types";

export type PromptPurpose =
  | "constitution"
  | "runtime"
  | "operator"
  | "workspace"
  | "interaction-profile"
  | "task"
  | "skill"
  | "memory"
  | "evidence";

export type PromptTrust =
  | "system"
  | "operator"
  | "authenticated"
  | "external"
  | "untrusted";

export interface PromptSegment {
  readonly purpose: PromptPurpose;
  readonly source: string;
  readonly digest: Digest;
  readonly trust: PromptTrust;
  readonly securityTags: readonly SecurityTagValue[];
  readonly classification: DataClassification;
  readonly content: string;
}

export interface PromptAssembly {
  readonly snapshot: SnapshotId;
  readonly segments: readonly PromptSegment[];
  readonly stablePrefix: readonly PromptSegment[];
  readonly volatileSuffix: readonly PromptSegment[];
  readonly cacheBreakpoint: number;
  readonly effectiveClassification: DataClassification;
}

export interface InteractionProfileInput {
  readonly source: string;
  readonly digest: Digest;
  readonly content: string;
}
