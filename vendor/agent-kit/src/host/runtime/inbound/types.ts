import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { Inbound } from "../../../core/channels/types.js";
import type { ApprovalGate } from "../../../plugins/trust/approval-gate.js";
import type { Observability } from "../../observability/types.js";
import type { RuntimeEnv } from "../types.js";

export type Deliver = (text: string) => Effect.Effect<void>;

export interface InboundContext {
  readonly message: Inbound;
  readonly env: RuntimeEnv;
  readonly obs: Observability;
  readonly approval: Option.Option<ApprovalGate>;
  readonly deliver: Deliver;
}

export interface ApprovalExecution {
  readonly gate: ApprovalGate;
  readonly command: ApprovalCommand;
  readonly message: Inbound;
  readonly deliver: Deliver;
}

export interface ApprovalCommand {
  readonly verb: "approve" | "deny";
  readonly nonce: string;
  readonly variantIndex?: number;
}
