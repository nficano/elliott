import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  hmacSha256Hex,
  verifiedRequestToken,
} from "../../../src/runtime/skills/http";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
} from "./fixtures";

// Tier-1 skill-logic smoke for webhook-provisioner: the ingress.webhook
// facility mints an endpoint, mounts a verification route, and forwards
// verified payloads over the loopback with the internal signature hop. See
// docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("webhook-provisioner skill logic (Tier 1)", () => {
  it("stays dormant without hooksBaseUrl or the internal webhook secret", async () => {
    const { context } = await makeSmokeContext({
      webhookProvisioner: undefined,
    });
    const registration = await loadOneSkill("webhook-provisioner", context);
    expect(registration.facilities ?? []).toHaveLength(0);
  });

  it("mints an hmac-sha256 endpoint and verifies an inbound payload", async () => {
    stubFetch([{ match: "127.0.0.1", body: "ok" }]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("webhook-provisioner", context);
    const facility = registration.facilities?.[0];
    if (facility === undefined) throw new Error("ingress.webhook missing");

    const grant = await facility.acquire({
      consumer: "test-consumer",
      name: "my-hook",
      config: { verification: { profile: "hmac-sha256" } },
    });
    const secret = grant.values["secret"];
    if (typeof secret !== "string") throw new Error("no minted secret");
    const url = String(grant.values["url"]);
    const path = new URL(url).pathname;

    const route = registration.routes?.find((item) => item.path === path);
    if (route === undefined) throw new Error("mounted route missing");
    const body = JSON.stringify({ hello: "world" });
    const request = new Request(`http://localhost${path}`, {
      method: "POST",
      body,
      headers: { "x-elliott-signature": hmacSha256Hex(secret, body) },
    });
    const response = await route.handle(request, makeGatewayEvents().events);
    expect(response.status).toBe(200);
  });

  it("drops a payload that fails token verification", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("webhook-provisioner", context);
    const facility = registration.facilities?.[0];
    if (facility === undefined) throw new Error("ingress.webhook missing");
    const grant = await facility.acquire({
      consumer: "test-consumer",
      name: "my-token-hook",
      config: { verification: { profile: "token-query" } },
    });
    const path = new URL(String(grant.values["url"])).pathname;
    const route = registration.routes?.find((item) => item.path === path);
    if (route === undefined) throw new Error("mounted route missing");

    const badRequest = new Request(`http://localhost${path}?token=wrong`, {
      method: "POST",
      body: "{}",
    });
    const response = await route.handle(badRequest, makeGatewayEvents().events);
    expect(response.status).toBe(401);
    // Sanity: the shared helper agrees the token was wrong.
    expect(verifiedRequestToken(badRequest, String(grant.values["secret"])))
      .toBe(false);
  });
});
