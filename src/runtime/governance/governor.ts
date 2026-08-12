import { scopeId } from "../../core/brands";
import { hashBytes, hashValue, newId } from "../../core/digest";
import type { RecordAppender, RecordDraft } from "../../core/waist/types";
import type { ToolDefinition, ToolExecutionContext } from "../types";
import { GovernanceDeniedError } from "./errors";
import type {
  GovernanceAttempt,
  GovernancePolicyView,
  GovernanceReporter,
  GovernanceStatus,
  PolicyDecision,
  ToolGovernorOptions,
} from "./types";

const AUDIT_MECHANISM = "governance-audit";
// The single chokepoint the whole runtime's tool traffic passes through. It
// wires the kernel's dormant tamper-evident AuditLog to the live tool path and
// adds the three controls the toolkit calls for: deterministic policy (deny +
// freeze + runtime disable), identity attribution, and a durable record of every
// invocation. Wrapped tools are indistinguishable from the originals, so this
// composes with the evolution decorator and is transparent to skills.
export class ToolGovernor {
  readonly #agent: string;
  readonly #records: RecordAppender;
  readonly #policy: GovernancePolicyView;
  readonly #report: GovernanceReporter;
  readonly #disabled = new Set<string>();
  #frozen = false;

  constructor(options: ToolGovernorOptions) {
    this.#agent = options.agent;
    this.#records = options.records;
    this.#policy = options.policy;
    this.#report = options.report ?? (() => undefined);
  }

  decorate(tools: readonly ToolDefinition[]): readonly ToolDefinition[] {
    return tools.map((tool) => this.guard(tool));
  }

  guard(tool: ToolDefinition): ToolDefinition {
    return {
      ...tool,
      execute: (input, context) => this.#run(tool, input, context),
    };
  }

  disable(tool: string, actor?: string): Promise<void> {
    this.#disabled.add(tool);
    return this.#control("governance.tool-disabled", { tool }, actor);
  }

  enable(tool: string, actor?: string): Promise<void> {
    this.#disabled.delete(tool);
    return this.#control("governance.tool-enabled", { tool }, actor);
  }

  freeze(actor?: string): Promise<void> {
    this.#frozen = true;
    return this.#control("governance.frozen", {}, actor);
  }

  unfreeze(actor?: string): Promise<void> {
    this.#frozen = false;
    return this.#control("governance.unfrozen", {}, actor);
  }

  status(): GovernanceStatus {
    return {
      frozen: this.#frozen,
      disabled: [...this.#disabled],
      denied: this.#policy.deniedTools,
    };
  }

  async #run(
    tool: ToolDefinition,
    input: unknown,
    context: ToolExecutionContext | undefined,
  ): Promise<string> {
    const decision: PolicyDecision = this.#decide(tool.name);
    const attempt: GovernanceAttempt = {
      tool: tool.name,
      invocationId: newId("toolcall"),
      input,
      ...(context !== undefined && { context }),
      decision,
    };
    await this.#audit(this.#invocationDraft(attempt));
    if (decision.effect === "deny") {
      throw new GovernanceDeniedError(tool.name, decision.reason);
    }
    const result = await tool.execute(input, context);
    await this.#audit(this.#resultDraft(attempt, result));
    return result;
  }

  #decide(toolName: string): PolicyDecision {
    if (this.#frozen) {
      return { effect: "deny", reason: "governance freeze active" };
    }
    if (this.#disabled.has(toolName)) {
      return { effect: "deny", reason: "tool disabled at runtime" };
    }
    return this.#policy.evaluate(toolName);
  }

  // Only ever records digests of arguments and results, never the raw values —
  // preserving the runtime's existing "no plaintext in telemetry" posture while
  // still binding each call to its principal and policy decision.
  #invocationDraft(attempt: GovernanceAttempt): RecordDraft {
    const principal = attempt.context?.principal;
    return {
      type: "tool.invocation",
      scope: { level: "invocation", id: scopeId(attempt.invocationId) },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        tool: attempt.tool,
        agent: principal?.agent ?? this.#agent,
        ...(principal?.actor !== undefined && { actor: principal.actor }),
        ...(principal?.gateway !== undefined && { gateway: principal.gateway }),
        ...(principal?.channel !== undefined && { channel: principal.channel }),
        argumentsDigest: hashValue(attempt.input),
        effect: attempt.decision.effect,
        reason: attempt.decision.reason,
      },
    };
  }

  #resultDraft(attempt: GovernanceAttempt, result: string): RecordDraft {
    return {
      type: "tool.result",
      scope: { level: "invocation", id: scopeId(attempt.invocationId) },
      durability: "observational",
      classification: "internal",
      payload: { tool: attempt.tool, resultDigest: hashBytes(result) },
    };
  }

  #control(
    type: string,
    detail: Readonly<Record<string, unknown>>,
    actor?: string,
  ): Promise<void> {
    return this.#audit({
      type,
      scope: { level: "agent", id: scopeId(this.#agent) },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        ...detail,
        agent: this.#agent,
        ...(actor !== undefined && { actor }),
      },
    });
  }

  async #audit(draft: RecordDraft): Promise<void> {
    try {
      await this.#records.append(draft);
    } catch (error) {
      // An audit-write failure must not crash tool execution or a kill switch.
      // Deny decisions are computed before this append and enforced regardless
      // of whether the record landed, so failing open here cannot grant access.
      this.#report(error, AUDIT_MECHANISM);
    }
  }
}
