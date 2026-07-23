// Information Flow Control via hierarchical context stacks — TDD §6.
// Classifications are strictly ordered: public < internal < confidential <
// restricted. The active posture (§0e) selects how much of the lattice
// exists; under `standard` the lattice is the single level `internal`.

import type { ComponentRef } from "../../core/types";
import type { DataClassification, ModelMessage } from "../../model/types";

export type FrameId = string & { readonly __brand: unique symbol; };

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
  /** Monotonic version for optimistic concurrency (§6c). */
  readonly revision: number;
}

export interface MergeRequest {
  readonly sourceFrame: FrameId;
  readonly sourceRevision: number;
  readonly targetFrame: FrameId;
  readonly rawOutput: string;
  readonly sanitizerComponent: ComponentRef;
  /** Declared by the requester, verified by the kernel against the sanitizer
   *  schema class. Commutative merges may be queued (§6c). */
  readonly ordering: "commutative" | "revision-dependent";
}

export interface MergeTicket {
  readonly id: string;
  readonly status: "queued" | "applied" | "rejected";
}

export interface ContextManager {
  readonly activeFrame: FrameId;
  fork(requestedClassification: DataClassification, reason: string): FrameId;
  merge(request: MergeRequest): Promise<MergeTicket>;
}
