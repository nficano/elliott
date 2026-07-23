import { describe, expect, it } from "bun:test";
import { digest, grantHandle, scopeId } from "../../src/core/brands";
import { hashBytes } from "../../src/core/digest";
import { EpochRegistry } from "../../src/core/epoch/epochs";
import { GrantRevokedError } from "../../src/core/errors";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { ApprovalService } from "../../src/security/approvals/approvals";
import type { ApprovalRequest } from "../../src/security/approvals/types";
import { CapabilityBroker } from "../../src/security/broker/broker";
import { GrantManager } from "../../src/security/grants/manager";
import {
  explainGrant,
  resolveGrantSet,
} from "../../src/security/grants/resolution";
import type { CapabilityGrantSource } from "../../src/security/grants/types";
import { OpaqueSecretStore } from "../../src/security/secrets/secrets";
import { makeGrantIssue, makeInvocation } from "../helpers";

const grantSources: readonly CapabilityGrantSource[] = [
  "request",
  "package",
  "organization",
  "workspace",
  "agent",
  "principal",
  "session",
];

const deferredApproval = (): ApprovalRequest => {
  const canonicalInput = "{\"capability\":\"network.connect\"}";
  return {
    id: "approval:deferred",
    purpose: "deferred-grant",
    invocationId: "invocation:test",
    session: scopeId("session"),
    target: makeInvocation().target,
    protocol: makeInvocation().protocol,
    operation: "execute",
    canonicalInput,
    inputDigest: hashBytes(canonicalInput),
    schemaDigest: digest("approval-schema"),
    requestedCapabilities: [{
      capability: "network.connect",
      resources: ["https://example.com/**"],
      deferred: true,
    }],
    preparedPlanDigest: digest("prepared-plan"),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    deferredScope: {
      posture: "hardened",
      workspace: scopeId("workspace"),
      invocationClass: "tool.executor:execute",
    },
  };
};

describe("G6 grant resolution and revocation", () => {
  it("removes a capability at every source and explains the removal", () => {
    const issue = makeGrantIssue();
    for (const removed of grantSources) {
      const sources = issue.sources.map((source) =>
        source.name === removed
          ? { ...source, capabilities: [] }
          : source
      );
      const input = { sources, limitSources: issue.limitSources };
      expect(resolveGrantSet(input).capabilities).toHaveLength(0);
      expect(explainGrant(input, "network.connect").removedBy).toBe(removed);
    }
    expect(resolveGrantSet(issue).limits).toEqual({
      maxCostUsd: 2,
      maxTokens: 50,
    });
  });

  it("drains and rejects the next brokered call after revocation", async () => {
    const records = new MemoryRecordAppender();
    const handle = grantHandle("grant:revocable");
    let drained = false;
    const grants = new GrantManager(new EpochRegistry(records));
    grants.issue(makeGrantIssue(handle, () => {
      drained = true;
    }));
    const broker = new CapabilityBroker(
      grants,
      records,
      new OpaqueSecretStore(),
    );
    const input = {
      invocation: makeInvocation(),
      handle,
      capability: "network.connect",
      resource: "https://example.com/api",
      frameClassification: "internal",
      destinationMaximumClassification: "internal",
      arguments: { query: "first" },
      execute: async () => "executed",
    };
    expect(await broker.execute(input)).toBe("executed");
    await grants.revoke(handle);
    await expect(broker.execute(input)).rejects.toBeInstanceOf(
      GrantRevokedError,
    );
    expect(drained).toBe(true);
  });

  it("keeps consumption live and activates deferred grants after approval", async () => {
    const records = new MemoryRecordAppender();
    const epochs = new EpochRegistry(records);
    const grants = new GrantManager(epochs);
    const handle = grantHandle("grant:deferred");
    const issue = makeGrantIssue(handle);
    grants.issue({
      ...issue,
      sources: issue.sources.map((source) =>
        source.name === "request"
          ? {
            ...source,
            capabilities: source.capabilities.map((capability) => ({
              ...capability,
              deferred: true,
            })),
          }
          : source
      ),
    });
    expect((await grants.resolve(handle)).capabilities).toHaveLength(0);
    expect(grants.explain(handle, "network.connect").removedBy).toBe(
      "deferred-approval",
    );

    const approvals = new ApprovalService(records, async () => "proposal");
    const request = deferredApproval();
    approvals.request(request);
    const outcome = await approvals.decide({
      requestId: request.id,
      decision: "allow-session",
      operator: "operator",
      presentedCanonicalInput: request.canonicalInput,
    });
    const before = epochs.current("session", "session");
    await grants.activateDeferred(handle, "network.connect", outcome);
    expect(epochs.current("session", "session")).toBe(before + 1);
    expect((await grants.resolve(handle)).capabilities).toHaveLength(1);

    grants.consume(handle, { concurrency: 0, costUsd: 1, tokens: 40 });
    expect(() =>
      grants.consume(handle, { concurrency: 0, costUsd: 0, tokens: 11 })
    ).toThrow("Live resource limit exceeded");
  });
});
