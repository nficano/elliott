// Information Flow Control via hierarchical context stacks — TDD §7.8.
// Classifications are strictly ordered: public < internal < confidential <
// restricted. The active posture (§7.2e) selects how much of the lattice
// exists; under `standard` the lattice is the single level `internal`.

import type * as Brand from "effect/Brand";
import type {
  ComponentRef,
  DataClassification,
  Digest,
} from "../../core/types";
import type { ModelMessage } from "../../model/types";

export type FrameId = Brand.Branded<string, "FrameId">;

/** Untrusted-content marking carried by frames, envelopes, and prompt
 *  segments. Renamed from Taint/TaintRecord (TDD revision 6 note). */
export interface SecurityTag {
  readonly source: ComponentRef;
  readonly classification: DataClassification;
  readonly reason: string;
}

export interface ContextFrame {
  readonly id: FrameId;
  readonly parentId?: FrameId;
  /** Kernel-maintained high-water mark. Monotonically non-decreasing for the
   *  frame's lifetime; only a sanitizer merge produces lower-classified data,
   *  and it produces it in the *target* frame, never by lowering the source. */
  readonly classification: DataClassification;
  readonly messages: readonly ModelMessage[];
  readonly securityTags: readonly SecurityTag[];
  /** Monotonic version for optimistic concurrency (§7.8c). */
  readonly revision: number;
}

export interface MergeRequest {
  readonly sourceFrame: FrameId;
  readonly sourceRevision: number;
  readonly targetFrame: FrameId;
  readonly rawOutput: string;
  readonly sanitizerComponent: ComponentRef;
  /** Declared by the requester, verified by the kernel against the sanitizer
   *  schema class. Commutative merges may be queued (§7.8c). */
  readonly ordering: "commutative" | "revision-dependent";
  readonly policySetDigest?: Digest;
  readonly schemaDigest?: Digest;
  readonly sanitizerComponentDigest?: Digest;
}

export interface MergeTicket {
  readonly id: string;
  readonly mergeId: string;
  readonly result: Promise<MergeResult>;
}

export interface MergeResult {
  readonly type: "merged" | "blocked-declassification" | "stale-merge";
  readonly output?: string;
}

export interface ContextManager {
  readonly activeFrame: FrameId;
  fork(requestedClassification: DataClassification, reason: string): FrameId;
  merge(request: MergeRequest): Promise<MergeTicket>;
}

export interface SanitizedMerge {
  readonly approved: boolean;
  readonly output?: string;
  readonly appendSafe?: boolean;
  readonly approvedVia?: "schema" | "schema+tle" | "human";
}

export interface FrameSanitizer {
  sanitize(request: MergeRequest): Promise<SanitizedMerge>;
}

export interface FrameWireInput {
  readonly frame: FrameId;
  readonly messages: readonly ModelMessage[];
  readonly tags: readonly SecurityTag[];
  readonly sourceClassification: DataClassification;
}

export interface MergeApplyInput {
  readonly request: MergeRequest;
  readonly output: string;
  readonly sanitized: boolean;
  readonly appendSafe: boolean;
}
