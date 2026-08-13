import { afterEach, describe, expect, it, mock } from "bun:test";
import { hmacSha256Hex } from "../../../src/runtime/skills/http";
import { loadOneSkill, makeGatewayEvents, makeSmokeContext } from "./fixtures";

// Tier-1 skill-logic smoke for gateway-webhook: HMAC verification and the
// accepted/rejected route paths. See
// docs/explanation/testing-strategy.md.

afterEach(() => {
  mock.restore();
});

const post = (body: string, signature?: string): Request =>
  new Request("http://localhost/v1/gateways/webhook", {
    method: "POST",
    body,
    ...(signature !== undefined && {
      headers: { "x-elliott-signature": signature },
    }),
  });

describe("gateway-webhook skill logic (Tier 1)", () => {
  it("stays dormant without its own gateway secret", async () => {
    const { context } = await makeSmokeContext({
      webhookGatewaySecret: undefined,
    });
    const registration = await loadOneSkill("gateway-webhook", context);
    expect(registration.routes ?? []).toHaveLength(0);
  });

  // Regression for the shared-secret bug: webhook-provisioner's internal
  // loopback-hop secret (webhookSecret) must never be sufficient on its own
  // to activate this unrelated public route — only webhookGatewaySecret may.
  it("stays dormant when only the internal webhook-provisioner secret is set", async () => {
    const { context } = await makeSmokeContext({
      webhookSecret: "internal-hop-only",
      webhookGatewaySecret: undefined,
    });
    const registration = await loadOneSkill("gateway-webhook", context);
    expect(registration.routes ?? []).toHaveLength(0);
  });

  it("rejects a payload with a bad or missing signature", async () => {
    const { context, reported } = await makeSmokeContext({
      webhookGatewaySecret: "topsecret",
    });
    const registration = await loadOneSkill("gateway-webhook", context);
    const route = registration.routes?.[0];
    if (route === undefined) throw new Error("webhook route missing");

    const response = await route.handle(
      post(JSON.stringify({ sender: "a", text: "hi" }), "wrong"),
      makeGatewayEvents().events,
    );
    expect(response.status).toBe(401);
    expect(reported).toHaveLength(1);
  });

  it("accepts a correctly-signed payload and dispatches it", async () => {
    const secret = "topsecret";
    const { context } = await makeSmokeContext({
      webhookGatewaySecret: secret,
    });
    const registration = await loadOneSkill("gateway-webhook", context);
    const route = registration.routes?.[0];
    if (route === undefined) throw new Error("webhook route missing");
    const { events, inbound } = makeGatewayEvents();

    const body = JSON.stringify({ sender: "alice", text: "hello there" });
    const signature = hmacSha256Hex(secret, body);
    const response = await route.handle(post(body, signature), events);
    expect(response.status).toBe(202);
    // onMessage is dispatched fire-and-forget; let the microtask flush.
    await Promise.resolve();
    expect(inbound[0]?.sender).toBe("alice");
    expect(inbound[0]?.text).toBe("hello there");
  });
});
