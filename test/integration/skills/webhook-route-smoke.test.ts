import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import type { RouteBinding } from "../../../src/runtime/skills/types";
import { loadOneSkill, makeGatewayEvents, makeSmokeContext } from "./fixtures";

// Tier-1 skill-logic smoke for the webhook gateway (a route skill). Exercises
// the route+events seam ElliottRuntime mounts: an HTTP request in ->
// signature/size/payload checks -> events.onMessage with a parsed
// InboundMessage. No socket, no agent, no model. This is the generalizable
// pattern for any route-backed skill. See docs/skill-e2e-smoke-strategy.md.

const PATH = "/v1/gateways/webhook";

const post = (body: string, signature?: string): Request =>
  new Request(`http://runtime${PATH}`, {
    method: "POST",
    headers: signature === undefined
      ? {}
      : { "x-elliott-signature": signature },
    body,
  });

// Reads the configured webhook secret straight from the fixture settings, so
// the signature the test computes is the real one the route verifies against.
const setup = async (): Promise<{
  readonly route: RouteBinding;
  sign: (body: string) => string;
}> => {
  const { context } = await makeSmokeContext();
  const secret = context.settings.webhookSecret;
  if (secret === undefined) throw new Error("fixture has no webhook secret");
  const registration = await loadOneSkill("gateway-webhook", context);
  const route = registration.routes?.[0];
  if (route === undefined) throw new Error("webhook route not registered");
  return {
    route,
    sign: (body) => createHmac("sha256", secret).update(body).digest("hex"),
  };
};

describe("gateway-webhook route logic (Tier 1)", () => {
  it("accepts a signed payload and forwards a parsed InboundMessage", async () => {
    const { route, sign } = await setup();
    const recorder = makeGatewayEvents();
    const body = JSON.stringify({
      sender: "svc",
      text: "hello",
      channel: "ops",
    });

    const response = await route.handle(
      post(body, sign(body)),
      recorder.events,
    );

    expect(response.status).toBe(202);
    // dispatch fires onMessage on a detached promise; let it settle.
    await Promise.resolve();
    expect(recorder.inbound).toHaveLength(1);
    const [message] = recorder.inbound;
    expect(message?.gateway).toBe("gateway-webhook");
    expect(message?.sender).toBe("svc");
    expect(message?.text).toBe("hello");
    expect(message?.channel).toBe("ops");
  });

  it("rejects a bad signature with 401 and no inbound delivery", async () => {
    const { route } = await setup();
    const recorder = makeGatewayEvents();
    const body = JSON.stringify({ sender: "svc", text: "hello" });

    const response = await route.handle(
      post(body, "deadbeef"),
      recorder.events,
    );

    expect(response.status).toBe(401);
    await Promise.resolve();
    expect(recorder.inbound).toEqual([]);
  });

  it("rejects a signed-but-malformed payload with 400", async () => {
    const { route, sign } = await setup();
    const recorder = makeGatewayEvents();
    const body = JSON.stringify({ sender: "svc" }); // missing text

    const response = await route.handle(
      post(body, sign(body)),
      recorder.events,
    );

    expect(response.status).toBe(400);
    expect(recorder.inbound).toEqual([]);
  });

  it("rejects an oversized body with 413 before signature work", async () => {
    const { route, sign } = await setup();
    const recorder = makeGatewayEvents();
    const body = "a".repeat(65_537);

    const response = await route.handle(
      post(body, sign(body)),
      recorder.events,
    );

    expect(response.status).toBe(413);
    expect(recorder.inbound).toEqual([]);
  });
});
