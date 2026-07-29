import type { RecordAppender } from "../../core/waist/types";
import type { CapabilityBroker } from "../../security/broker/broker";
import type { GrantManager } from "../../security/grants/manager";

export type PolicyEffect = "allow" | "deny";

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason: string;
}

export interface GovernancePolicyInput {
  readonly deny?: readonly string[];
  // Fallback verdict for a tool with no explicit rule. Defaults to "allow" so
  // the existing tool set keeps working; set "deny" to require an allow-list.
  readonly defaultEffect?: PolicyEffect;
}

// Structural surface the governor needs from a policy. Kept here (not imported
// from ./policy) so types ↔ policy never form a circular type graph — that
// cycle otherwise surfaces as "error typed value" on PolicyDecision.
export interface GovernancePolicyView {
  evaluate(toolName: string): PolicyDecision;
  readonly deniedTools: readonly string[];
}

export interface GovernanceControlPlaneBinding {
  handle(request: Request): Promise<Response>;
}

export interface GovernanceReporter {
  (error: unknown, mechanism: string): void;
}

export interface ToolGovernorOptions {
  // Which agent owns this runtime; stamped on records when the per-turn
  // principal is absent (e.g. a scheduler-driven tool call with no message).
  readonly agent: string;
  readonly records: RecordAppender;
  readonly policy: GovernancePolicyView;
  readonly report?: GovernanceReporter;
}

// Local structural shape — intentionally not ToolExecutionContext, so this
// module never imports the runtime types barrel (that import was poisoning
// PolicyDecision into an error type under the IDE type checker).
export interface GovernanceAttempt {
  readonly tool: string;
  readonly invocationId: string;
  readonly input: unknown;
  readonly context?: {
    readonly principal?: {
      readonly agent: string;
      readonly actor?: string;
      readonly gateway?: string;
      readonly channel?: string;
    };
  };
  readonly decision: PolicyDecision;
}

export interface GovernanceStatus {
  readonly frozen: boolean;
  readonly disabled: readonly string[];
  readonly denied: readonly string[];
}

// A high-risk tool routed through the real kernel CapabilityBroker for true
// default-deny, per-resource capability enforcement (vs. the default-allow tool
// policy). `resolveResource` extracts the resource being acted on from the tool
// input (e.g. the SSH host); the broker refuses it unless a seeded grant covers
// (capability, resource).
export interface CapabilityGateSpec {
  readonly tool: string;
  readonly capability: string;
  readonly resources: readonly string[];
  readonly resolveResource: (input: unknown) => string;
}

export interface CapabilityGateDeps {
  readonly broker: CapabilityBroker;
  readonly grants: GrantManager;
  readonly agent: string;
}
