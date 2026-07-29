import { afterEach, describe, expect, it, mock } from "bun:test";
import type { SkillRegistration } from "../../../src/runtime/skills/types";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
} from "./fixtures";

// Tier-1 skill-logic smoke for the BlueBubbles inbound webhook: an HTTP
// delivery from the BlueBubbles server in -> token/shape/allowlist checks ->
// events.onMessage with a normalized InboundMessage, plus the reply binding
// that sends the agent's answer back to the originating chat. No socket, no
// agent, no model. See docs/skill-e2e-smoke-strategy.md.

const PATH = "/v1/gateways/bluebubbles";
const TOKEN = "bluebubbles-hook"; // matches fixtures.smokeSettings
const SENDER = "+15555550100"; // on the fixture allowlist
const CHAT = `iMessage;-;${SENDER}`;

const webhookUrl = (token?: string): string =>
  token === undefined
    ? `http://runtime${PATH}`
    : `http://runtime${PATH}?token=${token}`;

const post = (body: unknown, token?: string): Request =>
  new Request(webhookUrl(token), {
    method: "POST",
    body: JSON.stringify(body),
  });

const newMessage = (
  overrides: Readonly<Record<string, unknown>> = {},
): unknown => ({
  type: "new-message",
  data: {
    guid: "MSG-1",
    text: "are you around?",
    isFromMe: false,
    handle: { address: SENDER },
    chats: [{ guid: CHAT, chatIdentifier: SENDER }],
    ...overrides,
  },
});

const setup = async (): Promise<SkillRegistration> => {
  const { context } = await makeSmokeContext();
  return loadOneSkill("gateway-bluebubbles", context);
};

const routeOf = (registration: SkillRegistration) => {
  const route = registration.routes?.[0];
  if (route === undefined) throw new Error("bluebubbles route not registered");
  return route;
};

afterEach(() => {
  mock.restore();
});

describe("gateway-bluebubbles webhook logic (Tier 1)", () => {
  it("registers the inbound route and the reply gateway", async () => {
    const registration = await setup();
    expect(routeOf(registration).path).toBe(PATH);
    expect(registration.gateways?.map((gateway) => gateway.name)).toEqual([
      "gateway-bluebubbles",
    ]);
  });

  it("accepts an allowlisted 1:1 message and forwards it", async () => {
    const route = routeOf(await setup());
    const recorder = makeGatewayEvents();

    const response = await route.handle(
      post(newMessage(), TOKEN),
      recorder.events,
    );

    expect(response.status).toBe(202);
    await Promise.resolve();
    expect(recorder.inbound).toHaveLength(1);
    const [message] = recorder.inbound;
    expect(message?.id).toBe("bluebubbles:MSG-1");
    expect(message?.gateway).toBe("gateway-bluebubbles");
    expect(message?.channel).toBe(CHAT);
    expect(message?.sender).toBe(SENDER);
    expect(message?.text).toBe("are you around?");
  });

  it("rejects a missing or wrong token with 401 and no dispatch", async () => {
    const route = routeOf(await setup());
    const recorder = makeGatewayEvents();

    expect((await route.handle(post(newMessage()), recorder.events)).status)
      .toBe(401);
    expect(
      (await route.handle(post(newMessage(), "wrong"), recorder.events))
        .status,
    ).toBe(401);
    expect(recorder.inbound).toEqual([]);
  });

  it("acknowledges but drops self-sent messages and tapbacks", async () => {
    const route = routeOf(await setup());
    const recorder = makeGatewayEvents();

    const fromMe = await route.handle(
      post(newMessage({ isFromMe: true }), TOKEN),
      recorder.events,
    );
    const tapback = await route.handle(
      post(newMessage({ associatedMessageGuid: "p:0/MSG-0" }), TOKEN),
      recorder.events,
    );

    expect(fromMe.status).toBe(202);
    expect(tapback.status).toBe(202);
    await Promise.resolve();
    expect(recorder.inbound).toEqual([]);
  });

  it("drops senders off the allowlist and group chats", async () => {
    const route = routeOf(await setup());
    const recorder = makeGatewayEvents();

    await route.handle(
      post(newMessage({ handle: { address: "+15555559999" } }), TOKEN),
      recorder.events,
    );
    await route.handle(
      post(newMessage({ chats: [{ guid: "iMessage;+;chat123" }] }), TOKEN),
      recorder.events,
    );

    await Promise.resolve();
    expect(recorder.inbound).toEqual([]);
  });

  it("rejects a malformed payload with 400", async () => {
    const route = routeOf(await setup());
    const recorder = makeGatewayEvents();

    const response = await route.handle(
      new Request(`http://runtime${PATH}?token=${TOKEN}`, {
        method: "POST",
        body: "not json",
      }),
      recorder.events,
    );

    expect(response.status).toBe(400);
    expect(recorder.inbound).toEqual([]);
  });

  it("replies to the originating chat through the BlueBubbles server", async () => {
    const registration = await setup();
    const gateway = registration.gateways?.[0];
    if (gateway?.send === undefined) throw new Error("reply gateway missing");
    const cassette = stubFetch([{
      match: "/api/v1/message/text",
      body: JSON.stringify({ status: 200, data: {} }),
    }]);

    await gateway.send(CHAT, "on my way");

    expect(cassette.calls).toHaveLength(1);
    expect(cassette.calls[0]).toContain("/api/v1/message/text");
  });
});
