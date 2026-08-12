import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { componentRef, principalId } from "../../src/core/brands";
import { MemoryRecordAppender } from "../../src/core/waist/records";
import { GatewayPipeline, WebhookHmacVerifier } from "../../src/gateway/index";

describe("gateway hmac and outbound", () => {
  it("verifies webhook signatures in constant time", async () => {
    const secret = new TextEncoder().encode("shared-secret");
    const verifier = new WebhookHmacVerifier(new Map([["route", secret]]));
    const route = {
      id: "route",
      agent: componentRef("workspace/agent/assistant"),
      tenant: "tenant",
      account: "primary",
      channel: "alerts",
      classification: "internal" as const,
      requireVerification: true,
      allowedPrincipals: new Set([principalId("principal:alice")]),
    };
    const body = "payload";
    const signature = `sha256=${
      createHmac("sha256", secret).update(body).digest("hex")
    }`;
    expect(
      await verifier.verify(route, {
        idempotencyKey: "k",
        routeId: "route",
        externalId: "alice",
        thread: "t",
        body,
        signature,
        attachments: [],
        receivedAt: new Date(0).toISOString(),
      }),
    ).toBe(true);
    expect(
      await verifier.verify(route, {
        idempotencyKey: "k",
        routeId: "route",
        externalId: "alice",
        thread: "t",
        body,
        attachments: [],
        receivedAt: new Date(0).toISOString(),
      }),
    ).toBe(false);
    expect(
      await verifier.verify({ ...route, id: "missing" }, {
        idempotencyKey: "k",
        routeId: "missing",
        externalId: "alice",
        thread: "t",
        body,
        signature,
        attachments: [],
        receivedAt: new Date(0).toISOString(),
      }),
    ).toBe(false);
  });

  it("delivers outbound payloads when policy allows", async () => {
    const records = new MemoryRecordAppender();
    const principal = principalId("principal:alice");
    const gateway = new GatewayPipeline({
      id: "webhook",
      routes: [{
        id: "route",
        agent: componentRef("workspace/agent/assistant"),
        tenant: "tenant",
        account: "primary",
        channel: "alerts",
        classification: "internal",
        requireVerification: false,
        allowedPrincipals: new Set([principal]),
      }],
      identities: [],
    }, {
      verifier: {
        async verify() {
          return true;
        },
      },
      authorizer: {
        async authorize() {
          return true;
        },
      },
      quarantine: {
        async quarantine(item) {
          return item.id;
        },
      },
      delivery: {
        async deliver(destination) {
          return `delivered:${destination}`;
        },
      },
      policy: {
        async allowOutbound() {
          return true;
        },
      },
      records,
    });
    const receipt = await gateway.outbound({
      routeId: "route",
      destination: "channel:alerts",
      envelope: {
        id: "gateway:1",
        principal,
        actorTrust: "authenticated",
        contentTrust: "untrusted",
        classification: "internal",
        securityTags: [],
        payload: { text: "hello", quarantinedAttachmentIds: [] },
        createdAt: new Date(0).toISOString(),
      },
    });
    expect(receipt.platformReceipt).toBe("delivered:channel:alerts");
    await expect(
      gateway.outbound({
        routeId: "missing",
        destination: "channel:alerts",
        envelope: {
          id: "gateway:2",
          principal,
          actorTrust: "authenticated",
          contentTrust: "untrusted",
          classification: "internal",
          securityTags: [],
          payload: { text: "nope", quarantinedAttachmentIds: [] },
          createdAt: new Date(0).toISOString(),
        },
      }),
    ).rejects.toThrow("outbound policy denied");
  });
});
