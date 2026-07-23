import type { DataClassification, Digest } from "../../core/types";
import type { PromptSegment } from "../../prompt/types";

export interface PromptCacheDirective {
  readonly segment: PromptSegment;
  readonly classification: DataClassification;
  readonly cache: boolean;
  readonly noStore: boolean;
}

export interface PromptCachePlan {
  readonly identity: Digest;
  readonly directives: readonly PromptCacheDirective[];
}
