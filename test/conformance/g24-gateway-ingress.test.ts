import { describe, expect, it } from "bun:test";
import { componentRef, principalId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { GatewayPipeline } from "../../src/gateway/index";

describe("G24 gateway ingress discipline", () => {
  it("verifies, resolves, authorizes, stamps, and deduplicates in order", async () => {
    const principal = principalId("principal:alice");
    const records = new MemoryRecordAppender();
    let verified = false;
    const gateway = new GatewayPipeline({
      id: "webhook",
      routes: [{
        id: "route",
        agent: componentRef("workspace/agent/assistant"),
        tenant: "tenant",
        account: "primary",
        channel: "alerts",
        classification: "confidential",
        requireVerification: true,
        allowedPrincipals: new Set([principal]),
      }],
      identities: [{
        gateway: "webhook",
        account: "primary",
        externalId: "alice-id",
        principal,
      }],
    }, {
      verifier: {
        async verify() {
          verified = true;
          return true;
        },
      },
      authorizer: {
        async authorize() {
          return verified;
        },
      },
      quarantine: {
        async quarantine(item) {
          return `quarantine:${item.id}`;
        },
      },
      delivery: {
        async deliver() {
          return "receipt";
        },
      },
      policy: {
        async allowOutbound() {
          return true;
        },
      },
      records,
    });
    const payload = {
      idempotencyKey: "event-1",
      routeId: "route",
      externalId: "alice-id",
      thread: "thread",
      body: "untrusted body",
      signature: "signature",
      attachments: [],
      receivedAt: new Date().toISOString(),
    };
    const accepted = await gateway.inbound(payload);
    expect(accepted.type).toBe("accepted");
    if (accepted.type === "accepted") {
      expect(accepted.envelope.contentTrust).toBe("untrusted");
      expect(accepted.envelope.classification).toBe("confidential");
      expect(accepted.session.principal).toBe(principal);
    }
    expect((await gateway.inbound(payload)).type).toBe("dropped");
  });

  it("drops unverifiable payloads before authorization", async () => {
    let authorized = false;
    const gateway = new GatewayPipeline({
      id: "webhook",
      routes: [{
        id: "route",
        agent: componentRef("workspace/agent/assistant"),
        tenant: "tenant",
        account: "primary",
        channel: "alerts",
        classification: "internal",
        requireVerification: true,
        allowedPrincipals: new Set(),
      }],
      identities: [],
    }, {
      verifier: {
        async verify() {
          return false;
        },
      },
      authorizer: {
        async authorize() {
          authorized = true;
          return true;
        },
      },
      quarantine: {
        async quarantine() {
          return "never";
        },
      },
      delivery: {
        async deliver() {
          return "never";
        },
      },
      policy: {
        async allowOutbound() {
          return false;
        },
      },
      records: new MemoryRecordAppender(),
    });
    const result = await gateway.inbound({
      idempotencyKey: "bad",
      routeId: "route",
      externalId: "unknown",
      thread: "thread",
      body: "body",
      attachments: [],
      receivedAt: new Date().toISOString(),
    });
    expect(result).toEqual({ type: "dropped", reason: "unverified" });
    expect(authorized).toBe(false);
  });
});
