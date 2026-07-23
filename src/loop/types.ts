import type {
  ComponentRef,
  DataClassification,
  SnapshotId,
} from "../core/types";
import type { Envelope, RecordAppender } from "../core/waist/types";
import type { PromptAssembly, PromptSegment } from "../prompt/types";

export type SilentReason =
  | "no-user-visible-result"
  | "duplicate"
  | "policy"
  | "heartbeat";

export type TurnDisposition =
  | { readonly type: "respond"; readonly message: Envelope<string>; }
  | { readonly type: "silent"; readonly reason: SilentReason; }
  | { readonly type: "heartbeat-ok"; readonly checkedAt: string; }
  | { readonly type: "blocked-no-route"; readonly error: Error; }
  | { readonly type: "blocked-declassification"; }
  | { readonly type: "stale-merge"; }
  | { readonly type: "merged"; readonly result: Envelope; };

export interface ToolCall {
  readonly id: string;
  readonly target: ComponentRef;
  readonly operation: string;
  readonly input: unknown;
}

export interface LoopInferenceResult {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
}

export interface LoopModelDispatcher {
  infer(prompt: PromptAssembly): Promise<LoopInferenceResult>;
}

export interface LoopToolBroker {
  execute(call: ToolCall, snapshot: SnapshotId): Promise<Envelope>;
}

export interface AgentTurnRequest {
  readonly inbound: Envelope;
  readonly snapshot: SnapshotId;
  readonly segments: readonly PromptSegment[];
}

export interface AgentLoopDependencies {
  readonly hasSnapshot: (snapshot: SnapshotId) => boolean;
  readonly dispatcher: LoopModelDispatcher;
  readonly broker: LoopToolBroker;
  readonly records: RecordAppender;
}

export type CausalEventKind =
  | "message"
  | "assistant-tool-call"
  | "approval"
  | "tool-result"
  | "retry"
  | "failure";

export interface CausalEvent {
  readonly id: string;
  readonly kind: CausalEventKind;
  readonly content: string;
}

export interface CausalBlock {
  readonly id: string;
  readonly classification: DataClassification;
  readonly events: readonly CausalEvent[];
}

export interface CompactionResult {
  readonly retained: readonly CausalBlock[];
  readonly compactedBlockIds: readonly string[];
  readonly summary?: CausalBlock;
}
