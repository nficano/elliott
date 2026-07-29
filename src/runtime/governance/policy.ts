import type {
  GovernancePolicyInput,
  GovernancePolicyView,
  PolicyDecision,
  PolicyEffect,
} from "./types";

// Deterministic, declarative allow/deny over tool names. This is the runtime
// analogue of the toolkit's policyRules (action + effect): denials live in one
// place instead of being reimplemented inside each skill's guard. It
// intentionally defaults to allow — the security value on the live path is the
// audit trail, identity attribution, and kill switch, not a from-scratch
// allow-list of all ~64 tools. The kernel CapabilityBroker remains available for
// true default-deny capability enforcement when a tool warrants it.
export class GovernancePolicy implements GovernancePolicyView {
  readonly #deny: ReadonlySet<string>;
  readonly #default: PolicyEffect;

  constructor(input: GovernancePolicyInput = {}) {
    this.#deny = new Set(input.deny);
    this.#default = input.defaultEffect ?? "allow";
  }

  evaluate(toolName: string): PolicyDecision {
    if (this.#deny.has(toolName)) {
      return { effect: "deny", reason: "denied by governance policy" };
    }
    if (this.#default === "deny") {
      return { effect: "deny", reason: "no allow rule for tool" };
    }
    return { effect: "allow", reason: "permitted by governance policy" };
  }

  get deniedTools(): readonly string[] {
    return [...this.#deny];
  }
}
