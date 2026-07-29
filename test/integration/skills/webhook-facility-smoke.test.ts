import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  RouteBinding,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { loadSkills, makeGatewayEvents, makeSmokeContext } from "./fixtures";
import type { LoadedWebhookFacility } from "./types";

// Tier-1 smoke for the ingress.webhook facility, end to end through the real
// two-pass loader: gateway-slack (a consumer, alphabetically FIRST) acquires
// an interactivity endpoint from webhook-provisioner (the provider) — which
// only works because providers register before consumers. A Slack-signed
// interaction then flows sender -> verification route -> loopback forward
// (internal HMAC hop) -> consumer route -> response_url acknowledgement.
// See docs/skill-facilities.md.

afterEach(() => {
  mock.restore();
});

const SIGNING_SECRET = "slack-signing"; // fixture slack.signingSecret

const load = async (
  existing?: Pick<LoadedWebhookFacility, "context" | "reported">,
): Promise<LoadedWebhookFacility> => {
  const { context, reported } = existing ?? await makeSmokeContext();
  const skills = await loadSkills(
    ["gateway-slack", "webhook-provisioner"],
    context,
  );
  const provider = skills.get("webhook-provisioner");
  const consumer = skills.get("gateway-slack");
  if (provider === undefined || consumer === undefined) {
    throw new Error(`skills failed to load: ${reported.join("; ")}`);
  }
  const verificationRoute = provider.routes?.find((route) =>
    route.path.startsWith("/w/")
  );
  const consumerRoute = consumer.routes?.find((route) =>
    route.path.startsWith("/v1/ingress/")
  );
  if (verificationRoute === undefined || consumerRoute === undefined) {
    throw new Error("facility routes were not mounted");
  }
  return {
    context,
    reported,
    provider,
    consumer,
    verificationRoute,
    consumerRoute,
    slug: verificationRoute.path.slice("/w/".length),
  };
};

// Intercepts the two hops the flow makes: the loopback forward (dispatched
// into the consumer route exactly as Bun.serve would) and outbound Slack
// calls (response_url ack, Web API).
const interceptFetch = (
  consumerRoute: RouteBinding,
  events: Parameters<RouteBinding["handle"]>[1],
): { readonly calls: { url: string; body: string; }[]; } => {
  const calls: { url: string; body: string; }[] = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    if (url.includes("/v1/ingress/")) {
      return consumerRoute.handle(new Request(url, init), events);
    }
    if (url.includes("hooks.slack.com") || url.includes("slack.com/api")) {
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
  spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
  return { calls };
};

const slackSigned = (
  payload: Readonly<Record<string, unknown>>,
  secret = SIGNING_SECRET,
  ageSeconds = 0,
): { readonly body: string; readonly headers: Record<string, string>; } => {
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const timestamp = Math.floor(Date.now() / 1000) - ageSeconds;
  const signature = createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": `v0=${signature}`,
    },
  };
};

const choicePayload = {
  type: "block_actions",
  user: { id: "U0" }, // fixture ownerId
  channel: { id: "C0" },
  message: { ts: "111.222" },
  response_url: "https://hooks.slack.com/actions/T0/1/abc",
  actions: [{ action_id: "elliott_choice_0", value: "Approve" }],
};

const postVerification = (
  route: RouteBinding,
  signed: { body: string; headers: Record<string, string>; },
  events: Parameters<RouteBinding["handle"]>[1],
): Promise<Response> =>
  route.handle(
    new Request(`http://runtime${route.path}`, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    }),
    events,
  );

describe("ingress.webhook grant (Tier 1)", () => {
  it("provisions a stable endpoint during consumer registration", async () => {
    const loaded = await load();
    expect(loaded.reported).toEqual([]);
    expect(loaded.slug.length).toBeGreaterThanOrEqual(21); // 128-bit base64url
    expect(loaded.consumerRoute.path).toBe(`/v1/ingress/${loaded.slug}`);

    const grants = JSON.parse(
      await readFile(
        path.join(loaded.context.stateDirectory, "facilities", "grants.json"),
        "utf8",
      ),
    );
    expect(grants.grants).toHaveLength(1);
    expect(grants.grants[0].consumer).toBe("gateway-slack");
    expect(grants.grants[0].name).toBe("slack-interactivity");
    expect(grants.grants[0].grant.values.url)
      .toBe(`https://hooks.smoke.test/w/${loaded.slug}`);
    // Sender-defined profile: the Slack signing secret must never be copied
    // into grant or endpoint storage — only the settings reference.
    const endpoints = await readFile(
      path.join(
        loaded.context.stateDirectory,
        "webhook-provisioner",
        "endpoints.json",
      ),
      "utf8",
    );
    expect(endpoints).not.toContain(SIGNING_SECRET);
    expect(endpoints).toContain("slack.signingSecret");
  });

  it("survives a reboot with the same slug and remounted routes", async () => {
    const first = await load();
    const second = await load(first);
    expect(second.slug).toBe(first.slug);
    expect(second.reported).toEqual([]);
  });
});

describe("slack interactivity through the facility (Tier 1)", () => {
  it("delivers a verified choice click and acknowledges via response_url", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);

    const response = await postVerification(
      loaded.verificationRoute,
      slackSigned(choicePayload),
      recorder.events,
    );

    expect(response.status).toBe(200);
    const forwarded = fetches.calls.find((call) =>
      call.url.includes("/v1/ingress/")
    );
    expect(forwarded).toBeDefined();
    const ack = fetches.calls.find((call) =>
      call.url.includes("hooks.slack.com")
    );
    expect(ack?.body).toContain("You picked *Approve*");
    expect(loaded.provider.services?.[0]?.health?.()).toMatchObject({
      endpoints: 1,
      verified: 1,
      dropped: 0,
    });
  });

  it("routes feedback buttons to onFeedback through the same endpoint", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    interceptFetch(loaded.consumerRoute, recorder.events);

    const feedback = {
      ...choicePayload,
      actions: [{ action_id: "elliott_feedback", value: "positive" }],
    };
    const response = await postVerification(
      loaded.verificationRoute,
      slackSigned(feedback),
      recorder.events,
    );

    expect(response.status).toBe(200);
    expect(recorder.feedback).toEqual([{
      gateway: "gateway-slack",
      channel: "C0",
      message: "111.222",
      sender: "U0",
      sentiment: "positive",
      source: "button",
    }]);
    expect(recorder.errors).toEqual([]);
  });

  it("drops a tampered signature before any forward", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);

    const signed = slackSigned(choicePayload, "wrong-secret");
    const response = await postVerification(
      loaded.verificationRoute,
      signed,
      recorder.events,
    );

    expect(response.status).toBe(401);
    expect(fetches.calls).toEqual([]);
    expect(loaded.provider.services?.[0]?.health?.()).toMatchObject({
      dropped: 1,
      verified: 0,
    });
    expect(
      loaded.reported.some((item) =>
        item.includes("webhook-provisioner:verify")
      ),
    ).toBe(true);
  });

  it("drops a replayed request outside the timestamp tolerance", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);

    const response = await postVerification(
      loaded.verificationRoute,
      slackSigned(choicePayload, SIGNING_SECRET, 600),
      recorder.events,
    );

    expect(response.status).toBe(401);
    expect(fetches.calls).toEqual([]);
  });

  it("caps the body before verification work", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);

    const response = await loaded.verificationRoute.handle(
      new Request(`http://runtime${loaded.verificationRoute.path}`, {
        method: "POST",
        body: "a".repeat(65_537),
      }),
      recorder.events,
    );

    expect(response.status).toBe(413);
    expect(fetches.calls).toEqual([]);
  });

  it("rejects internal deliveries that skip the signed hop", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const signed = slackSigned(choicePayload);

    const unsigned = await loaded.consumerRoute.handle(
      new Request(`http://runtime${loaded.consumerRoute.path}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: signed.body,
      }),
      recorder.events,
    );
    const badSignature = await loaded.consumerRoute.handle(
      new Request(`http://runtime${loaded.consumerRoute.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-elliott-signature": "deadbeef",
        },
        body: signed.body,
      }),
      recorder.events,
    );

    expect(unsigned.status).toBe(401);
    expect(badSignature.status).toBe(401);
  });

  it("honors the internal hop when signed with the runtime secret", async () => {
    const loaded = await load();
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);
    const signed = slackSigned(choicePayload);
    const secret = loaded.context.settings.webhookSecret;
    if (secret === undefined) throw new Error("fixture has no webhook secret");
    const internalSignature = createHmac("sha256", secret)
      .update(signed.body).digest("hex");

    const response = await loaded.consumerRoute.handle(
      new Request(`http://runtime${loaded.consumerRoute.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-elliott-signature": internalSignature,
        },
        body: signed.body,
      }),
      recorder.events,
    );

    expect(response.status).toBe(200);
    expect(
      fetches.calls.some((call) => call.url.includes("hooks.slack.com")),
    ).toBe(true);
  });
});

describe("ingress.webhook binding lifecycle (Tier 1)", () => {
  it("mints and returns the secret for facility-minted profiles", async () => {
    const loaded = await load();
    const binding = requireFacility(loaded);

    const grant = await binding.acquire({
      consumer: "test-consumer",
      name: "generic",
      config: { verification: { profile: "hmac-sha256" } },
    });

    const secret = grant.values["secret"];
    expect(typeof secret).toBe("string");
    const route = loaded.provider.routes?.find((item) =>
      item.path === `/w/${grant.grantId.split(":", 2)[1]}`
    );
    expect(route).toBeDefined();
    if (route === undefined) throw new Error("minted route missing");

    // The minted secret verifies a signed delivery end to end.
    const recorder = makeGatewayEvents();
    const fetches = interceptFetch(loaded.consumerRoute, recorder.events);
    const body = JSON.stringify({ ping: true });
    const response = await route.handle(
      new Request(`http://runtime${route.path}`, {
        method: "POST",
        headers: {
          "x-elliott-signature": createHmac("sha256", String(secret))
            .update(body).digest("hex"),
        },
        body,
      }),
      recorder.events,
    );
    // Forward hits /v1/ingress/<new slug>; our interceptor dispatches it into
    // the slack consumer route, which rejects the unrelated payload shape —
    // what matters here is that verification passed and the forward happened.
    expect(response.status).not.toBe(401);
    expect(fetches.calls.some((c) => c.url.includes("/v1/ingress/"))).toBe(
      true,
    );
  });

  it("re-acquiring with the same name keeps slug and secret", async () => {
    const loaded = await load();
    const binding = requireFacility(loaded);
    const config = { verification: { profile: "hmac-sha256" } };

    const first = await binding.acquire({
      consumer: "test-consumer",
      name: "generic",
      config,
    });
    const second = await binding.acquire({
      consumer: "test-consumer",
      name: "generic",
      config,
    });

    expect(second.values["url"]).toBe(first.values["url"]);
    expect(second.values["secret"]).toBe(first.values["secret"]);
  });

  it("refuses expired endpoints with 410", async () => {
    const loaded = await load();
    const binding = requireFacility(loaded);
    const grant = await binding.acquire({
      consumer: "test-consumer",
      name: "expiring",
      config: {
        verification: { profile: "hmac-sha256" },
        expiresAt: "2020-01-01T00:00:00Z",
      },
    });

    const route = loaded.provider.routes?.find((item) =>
      String(grant.values["internalPath"]).endsWith(item.path.slice(3))
    );
    if (route === undefined) throw new Error("expired route missing");
    const recorder = makeGatewayEvents();
    const response = await route.handle(
      new Request(`http://runtime${route.path}`, {
        method: "POST",
        body: "{}",
      }),
      recorder.events,
    );

    expect(response.status).toBe(410);
  });

  it("release unmounts the route and removes the endpoint record", async () => {
    const loaded = await load();
    const binding = requireFacility(loaded);
    const grant = await binding.acquire({
      consumer: "test-consumer",
      name: "temporary",
      config: { verification: { profile: "token-query" } },
    });
    const slug = grant.grantId.split(":", 2)[1];
    expect(loaded.provider.routes?.some((r) => r.path === `/w/${slug}`))
      .toBe(true);

    await binding.release?.(grant.grantId);

    expect(loaded.provider.routes?.some((r) => r.path === `/w/${slug}`))
      .toBe(false);
    const endpoints = await readFile(
      path.join(
        loaded.context.stateDirectory,
        "webhook-provisioner",
        "endpoints.json",
      ),
      "utf8",
    );
    expect(endpoints).not.toContain(slug);
  });

  it("rejects sender-defined profiles whose secretRef resolves to nothing", async () => {
    const loaded = await load();
    const binding = requireFacility(loaded);

    await expect(binding.acquire({
      consumer: "test-consumer",
      name: "broken",
      config: {
        verification: { profile: "slack-v2", secretRef: "slack.absent" },
      },
    })).rejects.toThrow(/resolves to no settings value/);
    await expect(binding.acquire({
      consumer: "test-consumer",
      name: "confused",
      config: {
        verification: {
          profile: "hmac-sha256",
          secretRef: "slack.signingSecret",
        },
      },
    })).rejects.toThrow(/mints its own secret/);
  });
});

const requireFacility = (
  loaded: LoadedWebhookFacility,
): NonNullable<SkillRegistration["facilities"]>[number] => {
  const binding = loaded.provider.facilities?.[0];
  if (binding === undefined) throw new Error("facility missing");
  return binding;
};
