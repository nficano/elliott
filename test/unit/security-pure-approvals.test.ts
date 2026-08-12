import { describe, expect, it } from "bun:test";
import {
  componentRef,
  digest,
  protocolId,
  scopeId,
} from "../../src/core/brands";
import { hashBytes } from "../../src/core/digest";
import { validatePresentation } from "../../src/security/approvals/approvals";
import type {
  ApprovalDecisionInput,
  ApprovalRequest,
} from "../../src/security/approvals/types";

const NOW_MS = 1_000_000;
const FUTURE_MS = 2_000_000;
const PAST_MS = 500_000;
const CANONICAL = "{\"request\":\"one\"}";

const request = (
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest => ({
  id: "approval:1",
  purpose: "tool-invocation",
  invocationId: "invocation:1",
  session: scopeId("session:1"),
  target: componentRef("workspace/tool/example"),
  protocol: protocolId("tool.executor"),
  operation: "execute",
  canonicalInput: CANONICAL,
  inputDigest: hashBytes(CANONICAL),
  schemaDigest: digest("schema"),
  requestedCapabilities: [],
  preparedPlanDigest: digest("plan"),
  expiresAt: new Date(FUTURE_MS).toISOString(),
  ...overrides,
});

const input = (
  overrides: Partial<ApprovalDecisionInput> = {},
): ApprovalDecisionInput => ({
  requestId: "approval:1",
  decision: "allow-once",
  operator: "operator",
  presentedCanonicalInput: CANONICAL,
  ...overrides,
});

describe("validatePresentation", () => {
  it("throws on presented bytes differing from the canonical input", () => {
    expect(() =>
      validatePresentation(
        request(),
        input({ presentedCanonicalInput: "different bytes" }),
        new Date(NOW_MS).toISOString(),
      )
    ).toThrow("approved bytes");
  });

  it("throws when the presented digest does not bind the request digest", () => {
    expect(() =>
      validatePresentation(
        request({ inputDigest: digest("mismatched") }),
        input(),
        new Date(NOW_MS).toISOString(),
      )
    ).toThrow("approved bytes");
  });

  it("throws when the decision happens after expiry", () => {
    expect(() =>
      validatePresentation(
        request({ expiresAt: new Date(PAST_MS).toISOString() }),
        input(),
        new Date(NOW_MS).toISOString(),
      )
    ).toThrow("Approval request expired");
  });

  it("does not throw when bytes bind and the request is live", () => {
    expect(() =>
      validatePresentation(
        request(),
        input(),
        new Date(NOW_MS).toISOString(),
      )
    ).not.toThrow();
  });

  it("does not throw when deciding exactly at the expiry boundary", () => {
    expect(() =>
      validatePresentation(
        request({ expiresAt: new Date(NOW_MS).toISOString() }),
        input(),
        new Date(NOW_MS).toISOString(),
      )
    ).not.toThrow();
  });
});
