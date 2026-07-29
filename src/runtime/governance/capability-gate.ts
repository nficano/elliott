import {
  componentRef,
  digest,
  grantHandle,
  principalId,
  protocolId,
  snapshotId,
} from "../../core/brands";
import { newId } from "../../core/digest";
import type { DataClassification, GrantHandle } from "../../core/types";
import type { Invocation } from "../../core/waist/types";
import type { GrantIssueInput } from "../../security/grants/types";
import type { ToolDefinition } from "../types";
import type { CapabilityGateDeps, CapabilityGateSpec } from "./types";

// The capability gate deals only in "internal" data: SSH host + command in, and
// stdout/stderr back, all of which the broker treats as internal-classified.
const GATE_CLASSIFICATION: DataClassification = "internal";

// A single "request" source with the allowlisted resources is a complete grant:
// resolveGrantSet seeds from the request source and only *removes* a capability
// when another present source omits it, so with no other sources the capability
// survives exactly over `resources`. Per-host default-deny falls out of the
// broker's exact/`/**` resource match against this set.
const buildGrantIssue = (
  handle: GrantHandle,
  capability: string,
  resources: readonly string[],
): GrantIssueInput => ({
  handle,
  coordinates: {
    organization: "organization",
    workspace: "workspace",
    agent: "agent",
    session: "session",
    principal: "principal",
  },
  policyDigests: [digest("policy:governance-capability-gate")],
  onDrain: () => undefined,
  sources: [{ name: "request", capabilities: [{ capability, resources }] }],
  limitSources: [],
});

// Most Invocation fields are inert for a synthetic runtime tool call; the broker
// reads origin.id (audit scope), id, target, and principal. The rest are filled
// with well-formed placeholders so the object satisfies the kernel contract.
const buildInvocation = (
  agent: string,
  tool: string,
  input: unknown,
): Invocation => ({
  id: newId("invocation"),
  principal: principalId(`workspace/agent/${agent}`),
  agent: componentRef(`workspace/agent/${agent}`),
  target: componentRef(`workspace/tool/${tool}`),
  protocol: protocolId("tool.executor"),
  operation: "execute",
  input,
  inputSchemaDigest: digest("input"),
  outputSchemaDigest: digest("output"),
  origin: {
    id: newId("origin"),
    actorTrust: "authenticated",
    contentTrust: "trusted",
    classification: GATE_CLASSIFICATION,
    securityTags: [],
    payload: {},
    createdAt: new Date().toISOString(),
  },
  securityTags: [],
  requestedCapabilities: [],
  budget: {},
  snapshot: snapshotId("governance-capability-gate"),
});

// Wraps one named high-risk tool so its execution is materialized through the
// kernel CapabilityBroker: default-deny, per-resource, with broker.dispatch /
// broker.result records landing in the same durable, tamper-evident audit log
// as the governor's tool.invocation / tool.result. Composes under ToolGovernor —
// apply the gate first, then let the governor wrap the gated tool.
export class CapabilityGate {
  readonly #deps: CapabilityGateDeps;
  readonly #spec: CapabilityGateSpec;
  readonly #handle: GrantHandle;

  constructor(deps: CapabilityGateDeps, spec: CapabilityGateSpec) {
    this.#deps = deps;
    this.#spec = spec;
    this.#handle = grantHandle(`grant:tool:${spec.tool}`);
    deps.grants.issue(
      buildGrantIssue(this.#handle, spec.capability, spec.resources),
    );
  }

  decorate(tools: readonly ToolDefinition[]): readonly ToolDefinition[] {
    return tools.map((tool) => this.apply(tool));
  }

  apply(tool: ToolDefinition): ToolDefinition {
    if (tool.name !== this.#spec.tool) return tool;
    return {
      ...tool,
      execute: (input, context) =>
        this.#deps.broker.execute({
          invocation: buildInvocation(this.#deps.agent, this.#spec.tool, input),
          handle: this.#handle,
          capability: this.#spec.capability,
          resource: this.#spec.resolveResource(input),
          frameClassification: GATE_CLASSIFICATION,
          destinationMaximumClassification: GATE_CLASSIFICATION,
          arguments: input,
          execute: (_grant, args) => tool.execute(args, context),
        }),
    };
  }
}
