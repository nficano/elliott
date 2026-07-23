import { describe, expect, it } from "bun:test";
import {
  componentRef,
  digest,
  protocolId,
  scopeId,
} from "../../src/core/brands";
import { hashBytes } from "../../src/core/digest";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { compileCgroupSettings } from "../../src/placement/cgroups/index";
import { ApprovalService } from "../../src/security/approvals/approvals";
import type {
  ApprovalRequest,
  DeferredApprovalScope,
} from "../../src/security/approvals/types";

const approval = (
  id: string,
  purpose: ApprovalRequest["purpose"] = "tool-invocation",
  deferredScope?: DeferredApprovalScope,
): ApprovalRequest => {
  const canonicalInput = `{"request":"${id}"}`;
  return {
    id,
    purpose,
    invocationId: `invocation:${id}`,
    session: scopeId(`session:${id}`),
    target: componentRef("workspace/tool/example"),
    protocol: protocolId("tool.executor"),
    operation: "execute",
    canonicalInput,
    inputDigest: hashBytes(canonicalInput),
    schemaDigest: digest("schema"),
    requestedCapabilities: [],
    preparedPlanDigest: digest("plan"),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...(deferredScope !== undefined && { deferredScope }),
  };
};

describe("M5 approvals and resource enforcement", () => {
  it("binds decisions to bytes and expires session allowances", async () => {
    let proposals = 0;
    const service = new ApprovalService(
      new MemoryRecordAppender(),
      async () => {
        proposals += 1;
        return "proposal:one";
      },
    );
    const request = approval("session");
    service.request(request);
    await expect(service.decide({
      requestId: request.id,
      decision: "allow-session",
      operator: "operator",
      presentedCanonicalInput: "different bytes",
    })).rejects.toThrow("approved bytes");
    await service.decide({
      requestId: request.id,
      decision: "allow-session",
      operator: "operator",
      presentedCanonicalInput: request.canonicalInput,
    });
    expect(service.allowedForSession(request)).toBe(true);
    expect(proposals).toBe(0);
    service.closeSession(request.session);
    expect(service.allowedForSession(request)).toBe(false);
  });

  it("creates standing policy only through propose-policy", async () => {
    let proposals = 0;
    const service = new ApprovalService(
      new MemoryRecordAppender(),
      async () => {
        proposals += 1;
        return "proposal:explicit";
      },
    );
    const request = approval("proposal");
    service.request(request);
    const outcome = await service.decide({
      requestId: request.id,
      decision: "propose-policy",
      operator: "operator",
      presentedCanonicalInput: request.canonicalInput,
    });
    expect(outcome.proposalId).toBe("proposal:explicit");
    expect(proposals).toBe(1);
  });

  it("remembers deferred approvals at the posture-specific scope", async () => {
    const service = new ApprovalService(
      new MemoryRecordAppender(),
      async () => "proposal",
    );
    const standardScope: DeferredApprovalScope = {
      posture: "standard",
      workspace: scopeId("workspace"),
      invocationClass: "class-a",
    };
    const first = approval("first", "deferred-grant", standardScope);
    service.request(first);
    await service.decide({
      requestId: first.id,
      decision: "allow-once",
      operator: "operator",
      presentedCanonicalInput: first.canonicalInput,
    });
    const sameWorkspace = approval("other-session", "deferred-grant", {
      ...standardScope,
      invocationClass: "class-b",
    });
    expect(service.deferredApproved(sameWorkspace)).toBe(true);

    const regulated = approval("regulated", "deferred-grant", {
      posture: "regulated",
      workspace: scopeId("workspace"),
      invocationClass: "sensitive-class",
    });
    service.request(regulated);
    expect(service.deferredQueue()).toEqual([regulated]);
    await service.decide({
      requestId: regulated.id,
      decision: "allow-once",
      operator: "operator",
      presentedCanonicalInput: regulated.canonicalInput,
    });
    expect(service.deferredQueue()).toHaveLength(0);
    expect(service.deferredApproved(regulated)).toBe(true);
  });

  it("limits hardened deferred approval memory to one session", async () => {
    const service = new ApprovalService(
      new MemoryRecordAppender(),
      async () => "proposal",
    );
    const hardenedScope: DeferredApprovalScope = {
      posture: "hardened",
      workspace: scopeId("workspace"),
      invocationClass: "class-a",
    };
    const first = approval("hardened", "deferred-grant", hardenedScope);
    service.request(first);
    await service.decide({
      requestId: first.id,
      decision: "allow-session",
      operator: "operator",
      presentedCanonicalInput: first.canonicalInput,
    });
    const sameSession = {
      ...approval("same-session", "deferred-grant", hardenedScope),
      session: first.session,
    };
    const otherSession = approval(
      "other-session",
      "deferred-grant",
      hardenedScope,
    );
    expect(service.deferredApproved(sameSession)).toBe(true);
    expect(service.deferredApproved(otherSession)).toBe(false);
    service.closeSession(first.session);
    expect(service.deferredApproved(sameSession)).toBe(false);
  });

  it("compiles only OS-enforceable limits into cgroups", () => {
    expect(compileCgroupSettings({
      limits: {
        cpuQuota: 2,
        memoryMb: 64,
        pids: 10,
        ioBytesPerSecond: 4096,
        maxConcurrency: 3,
        maxCostUsd: 1,
        maxTokens: 100,
      },
    })).toEqual({
      cpuMax: 2,
      memoryMaxBytes: 67_108_864,
      pidsMax: 10,
      ioMaxBytesPerSecond: 4096,
    });
  });
});
