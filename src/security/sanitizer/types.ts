import type { DataClassification, Digest } from "../../core/types";
import type { RecordAppender } from "../../core/waist/types";

export interface SanitizeRequest {
  readonly sourceContent: string;
  readonly proposedOutput: string;
  readonly sourceClassification: DataClassification;
  readonly targetClassification: DataClassification;
  readonly policySetDigest: Digest;
  readonly schemaDigest: Digest;
  readonly sanitizerComponentDigest: Digest;
}

export interface SanitizerDecision {
  readonly isApproved: boolean;
  readonly approvedVia?: "schema" | "schema+tle" | "human";
  readonly servedFromCache: boolean;
  readonly sanitizedOutput?: string;
  readonly violationReason?: string;
  readonly tleConfidence?: number;
  readonly appendSafe: boolean;
}

export interface CompiledSanitizerSchema {
  readonly digest: Digest;
  readonly appendSafe: boolean;
  validate(output: string): boolean;
}

export interface TrustedEvaluatorVerdict {
  readonly approved: boolean;
  readonly confidence?: number;
  readonly reason?: string;
}

export interface TrustedLocalEvaluator {
  evaluate(request: SanitizeRequest): Promise<TrustedEvaluatorVerdict>;
  evaluateBatch(
    requests: readonly SanitizeRequest[],
  ): Promise<readonly TrustedEvaluatorVerdict[]>;
}

export interface HumanSanitizerReview {
  review(request: SanitizeRequest): Promise<boolean>;
}

export interface SanitizerPipelineConfig {
  readonly schemas: readonly CompiledSanitizerSchema[];
  readonly evaluator: TrustedLocalEvaluator;
  readonly humanReview: HumanSanitizerReview;
  readonly records: RecordAppender;
  readonly requireTrustedEvaluator: boolean;
}

export interface SanitizerProtocol {
  sanitize(request: SanitizeRequest): Promise<SanitizerDecision>;
  sanitizeBatch(
    requests: readonly SanitizeRequest[],
  ): Promise<readonly SanitizerDecision[]>;
}
