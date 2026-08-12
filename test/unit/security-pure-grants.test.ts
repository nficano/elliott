import { describe, expect, it } from "bun:test";
import {
  componentRef,
  digest,
  protocolId,
  scopeId,
} from "../../src/core/brands";
import { hashBytes } from "../../src/core/digest";
import type { CapabilityRequest } from "../../src/core/types";
import type {
  ApprovalDecision,
  ApprovalOutcome,
  ApprovalPurpose,
  ApprovalRequest,
} from "../../src/security/approvals/types";
import {
  isDeferredActivationValid,
  nextConsumption,
} from "../../src/security/grants/manager";
import type {
  GrantConsumption,
  ResourceLimits,
} from "../../src/security/grants/types";

const NOW_MS = 1_000_000;
const FUTURE_MS = 2_000_000;
const CAPABILITY = "fs.read";

const request = (
  purpose: ApprovalPurpose,
  capabilities: readonly CapabilityRequest[],
  expiresMs: number,
): ApprovalRequest => {
  const canonicalInput = "{\"deferred\":true}";
  return {
    id: "approval:1",
    purpose,
    invocationId: "invocation:1",
    session: scopeId("session:1"),
    target: componentRef("workspace/tool/fs"),
    protocol: protocolId("tool.executor"),
    operation: "read",
    canonicalInput,
    inputDigest: hashBytes(canonicalInput),
    schemaDigest: digest("schema"),
    requestedCapabilities: capabilities,
    preparedPlanDigest: digest("plan"),
    expiresAt: new Date(expiresMs).toISOString(),
  };
};

const outcome = (
  purpose: ApprovalPurpose,
  decision: ApprovalDecision,
  capabilities: readonly CapabilityRequest[],
  expiresMs = FUTURE_MS,
): ApprovalOutcome => ({
  request: request(purpose, capabilities, expiresMs),
  decision,
  operator: "operator",
  decidedAt: new Date(NOW_MS).toISOString(),
});

const deferredCap: CapabilityRequest = {
  capability: CAPABILITY,
  resources: ["fs:/data/**"],
  deferred: true,
};

describe("isDeferredActivationValid", () => {
  it("rejects a non deferred-grant purpose", () => {
    const result = isDeferredActivationValid(
      outcome("tool-invocation", "allow-once", [deferredCap]),
      CAPABILITY,
      NOW_MS,
    );
    expect(result).toBe(false);
  });

  it("rejects a decision that is neither allow-once nor allow-session", () => {
    const result = isDeferredActivationValid(
      outcome("deferred-grant", "deny-once", [deferredCap]),
      CAPABILITY,
      NOW_MS,
    );
    expect(result).toBe(false);
  });

  it("rejects when no requested capability matches and is deferred", () => {
    const wrongName = isDeferredActivationValid(
      outcome("deferred-grant", "allow-once", [{
        capability: "fs.write",
        resources: ["fs:/data/**"],
        deferred: true,
      }]),
      CAPABILITY,
      NOW_MS,
    );
    const notDeferred = isDeferredActivationValid(
      outcome("deferred-grant", "allow-once", [{
        capability: CAPABILITY,
        resources: ["fs:/data/**"],
        deferred: false,
      }]),
      CAPABILITY,
      NOW_MS,
    );
    expect(wrongName).toBe(false);
    expect(notDeferred).toBe(false);
  });

  it("rejects when the approval has expired at the boundary", () => {
    const result = isDeferredActivationValid(
      outcome("deferred-grant", "allow-once", [deferredCap], NOW_MS),
      CAPABILITY,
      NOW_MS,
    );
    expect(result).toBe(false);
  });

  it("accepts a live deferred-grant with a matching deferred capability", () => {
    expect(
      isDeferredActivationValid(
        outcome("deferred-grant", "allow-once", [deferredCap]),
        CAPABILITY,
        NOW_MS,
      ),
    ).toBe(true);
    expect(
      isDeferredActivationValid(
        outcome("deferred-grant", "allow-session", [deferredCap]),
        CAPABILITY,
        NOW_MS,
      ),
    ).toBe(true);
  });
});

const consumption = (
  concurrency: number,
  costUsd: number,
  tokens: number,
): GrantConsumption => ({ concurrency, costUsd, tokens });

describe("nextConsumption", () => {
  it("sums current and delta into next", () => {
    const { next, exceeded } = nextConsumption(
      consumption(1, 2, 3),
      consumption(4, 5, 6),
      {},
    );
    expect(next).toEqual(consumption(5, 7, 9));
    expect(exceeded).toBe(false);
  });

  it("does not exceed when limits are undefined", () => {
    const { exceeded } = nextConsumption(
      consumption(100, 100, 100),
      consumption(100, 100, 100),
      {},
    );
    expect(exceeded).toBe(false);
  });

  it("treats reaching a limit exactly as not exceeded", () => {
    const limits: ResourceLimits = {
      maxConcurrency: 2,
      maxCostUsd: 4,
      maxTokens: 6,
    };
    const { exceeded } = nextConsumption(
      consumption(1, 2, 3),
      consumption(1, 2, 3),
      limits,
    );
    expect(exceeded).toBe(false);
  });

  it("flags exceeding maxConcurrency", () => {
    const { exceeded } = nextConsumption(
      consumption(2, 0, 0),
      consumption(1, 0, 0),
      { maxConcurrency: 2 },
    );
    expect(exceeded).toBe(true);
  });

  it("flags exceeding maxCostUsd", () => {
    const { exceeded } = nextConsumption(
      consumption(0, 2, 0),
      consumption(0, 3, 0),
      { maxCostUsd: 4 },
    );
    expect(exceeded).toBe(true);
  });

  it("flags exceeding maxTokens", () => {
    const { exceeded } = nextConsumption(
      consumption(0, 0, 6),
      consumption(0, 0, 1),
      { maxTokens: 6 },
    );
    expect(exceeded).toBe(true);
  });
});
