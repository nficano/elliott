import { afterEach, describe, expect, it, mock } from "bun:test";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
} from "./fixtures";

// Tier-1 skill-logic smoke for the Gmail push webhook: a Pub/Sub push in ->
// token/envelope checks -> anchor bookkeeping -> history diff + metadata
// fetch (cassette-stubbed Gmail API) -> events.onMessage with one
// notification turn. Also covers the notification reply binding
// (context.deliver relay) and the users.watch renewal service. See
// docs/skill-e2e-smoke-strategy.md.

const PATH = "/v1/gateways/gmail";
const TOKEN = "gmail-hook"; // matches fixtures.smokeSettings
const MAILBOX = "owner@example.com";

const webhookUrl = (token?: string): string =>
  token === undefined
    ? `http://runtime${PATH}`
    : `http://runtime${PATH}?token=${token}`;

const push = (historyId: number, token?: string): Request =>
  new Request(webhookUrl(token), {
    method: "POST",
    body: JSON.stringify({
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: MAILBOX, historyId }),
        ).toString("base64"),
        messageId: `pubsub-${historyId}`,
      },
      subscription: "projects/smoke/subscriptions/gmail",
    }),
  });

// Cassette for the full reconcile path: OAuth token mint, the history diff,
// and the metadata fetch for the one added message.
const stubGmailApi = () =>
  stubFetch([
    {
      match: "oauth2.googleapis.com/token",
      body: JSON.stringify({ access_token: "at", expires_in: 3600 }),
    },
    {
      match: "/users/me/history",
      body: JSON.stringify({
        historyId: "200",
        history: [{
          id: "150",
          messagesAdded: [
            { message: { id: "MSG-1", threadId: "TH-1", labelIds: ["INBOX"] } },
          ],
        }],
      }),
    },
    {
      match: "/users/me/messages/MSG-1",
      body: JSON.stringify({
        id: "MSG-1",
        threadId: "TH-1",
        snippet: "Quarterly numbers attached",
        payload: {
          headers: [
            { name: "From", value: "Jane <jane@example.net>" },
            { name: "Subject", value: "Q3 numbers" },
          ],
        },
      }),
    },
    {
      match: "/users/me/watch",
      body: JSON.stringify({ historyId: "90", expiration: "1799999999999" }),
    },
    {
      match: "/users/me/profile",
      body: JSON.stringify({ emailAddress: MAILBOX }),
    },
  ]);

const setup = async (): Promise<{
  readonly registration: SkillRegistration;
  readonly context: SkillContext;
  readonly delivered: readonly string[];
}> => {
  const { context, delivered } = await makeSmokeContext();
  return {
    registration: await loadOneSkill("gateway-gmail", context),
    context,
    delivered,
  };
};

const routeOf = (registration: SkillRegistration) => {
  const route = registration.routes?.[0];
  if (route === undefined) throw new Error("gmail route not registered");
  return route;
};

// Reconcile runs on a detached serialized queue; give its promise chain a few
// macrotask turns to settle before asserting.
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

afterEach(() => {
  mock.restore();
});

describe("gateway-gmail webhook logic (Tier 1)", () => {
  it("registers the route, reply gateway, and watch service", async () => {
    const { registration } = await setup();
    expect(routeOf(registration).path).toBe(PATH);
    expect(registration.gateways?.map((gateway) => gateway.name)).toEqual([
      "gateway-gmail",
    ]);
    expect(registration.services?.map((service) => service.name)).toEqual([
      "gmail-watch",
    ]);
  });

  it("anchors on the first push, then notifies on the next", async () => {
    stubGmailApi();
    const { registration } = await setup();
    const route = routeOf(registration);
    const recorder = makeGatewayEvents();

    const first = await route.handle(push(100, TOKEN), recorder.events);
    await settle();
    expect(first.status).toBe(202);
    expect(recorder.inbound).toEqual([]); // no window to diff yet

    const second = await route.handle(push(200, TOKEN), recorder.events);
    await settle();
    expect(second.status).toBe(202);
    expect(recorder.errors).toEqual([]);
    expect(recorder.inbound).toHaveLength(1);
    const [message] = recorder.inbound;
    expect(message?.id).toBe("gmail:pubsub-200");
    expect(message?.gateway).toBe("gateway-gmail");
    expect(message?.channel).toBe(MAILBOX);
    expect(message?.text).toContain("Jane <jane@example.net>");
    expect(message?.text).toContain("Q3 numbers");
    expect(message?.text).toContain("threadId TH-1");
    expect(message?.text).toContain("untrusted");
  });

  it("skips stale pushes that are behind the stored anchor", async () => {
    stubGmailApi();
    const { registration } = await setup();
    const route = routeOf(registration);
    const recorder = makeGatewayEvents();

    await route.handle(push(100, TOKEN), recorder.events);
    await route.handle(push(200, TOKEN), recorder.events);
    await settle();
    const notified = recorder.inbound.length;
    await route.handle(push(150, TOKEN), recorder.events);
    await settle();

    expect(recorder.inbound).toHaveLength(notified);
  });

  it("rejects a bad token with 401 and a bad envelope with 400", async () => {
    const { registration } = await setup();
    const route = routeOf(registration);
    const recorder = makeGatewayEvents();

    expect((await route.handle(push(100), recorder.events)).status).toBe(401);
    expect(
      (await route.handle(push(100, "wrong"), recorder.events)).status,
    ).toBe(401);
    const malformed = await route.handle(
      new Request(`http://runtime${PATH}?token=${TOKEN}`, {
        method: "POST",
        body: JSON.stringify({ message: { data: "" } }),
      }),
      recorder.events,
    );
    expect(malformed.status).toBe(400);
    await settle();
    expect(recorder.inbound).toEqual([]);
  });

  it("relays notification answers through context.deliver", async () => {
    const { registration, delivered } = await setup();
    const gateway = registration.gateways?.[0];
    if (gateway?.send === undefined) throw new Error("reply gateway missing");

    await gateway.send(MAILBOX, "You got mail from Jane about Q3.");

    expect(delivered).toEqual(["You got mail from Jane about Q3."]);
  });

  it("renews the mailbox watch and seeds the anchor", async () => {
    const cassette = stubGmailApi();
    const { registration } = await setup();
    const service = registration.services?.[0];
    if (service === undefined) throw new Error("watch service missing");

    try {
      await service.start();
      await settle();
    } finally {
      await service.stop();
    }

    expect(service.health?.()).toMatchObject({ renewals: 1, failures: 0 });
    expect(
      cassette.calls.some((url) => url.includes("/users/me/watch")),
    ).toBe(true);
  });
});
