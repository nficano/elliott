import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeGatewayEvents,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for gateway-bluebubbles: read/send tools and the
// inbound webhook's token verification + sender allowlist. See
// docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("gateway-bluebubbles skill logic (Tier 1)", () => {
  it("stays dormant without bluebubbles settings", async () => {
    const { context } = await makeSmokeContext({ bluebubbles: undefined });
    const registration = await loadOneSkill("gateway-bluebubbles", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("reads recent messages from the paired server", async () => {
    stubFetch([{
      match: "/api/v1/message/query",
      body: JSON.stringify({
        data: [{
          isFromMe: false,
          text: "hey",
          dateCreated: 0,
          handle: { address: "+15555550100" },
        }],
      }),
    }]);
    const { context } = await makeSmokeContext();
    const tool = toolByName(
      await loadOneSkill("gateway-bluebubbles", context),
      "imessage_read",
    );
    const result = JSON.parse(await tool.execute({}));
    expect(result.messages[0].text).toBe("hey");
    expect(result.messages[0].from).toBe("+15555550100");
  });

  it("rejects a send to a recipient outside the allowlist", async () => {
    const { context } = await makeSmokeContext();
    const tool = toolByName(
      await loadOneSkill("gateway-bluebubbles", context),
      "imessage_send",
    );
    await expect(
      tool.execute({ text: "hi", to: "+19995550100" }),
    ).rejects.toThrow(/allowlist/);
  });

  it("rejects an inbound webhook delivery with the wrong token", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("gateway-bluebubbles", context);
    const route = registration.routes?.[0];
    if (route === undefined) {
      throw new Error("bluebubbles webhook route missing");
    }
    const request = new Request(
      "http://localhost/v1/gateways/bluebubbles?token=wrong",
      { method: "POST", body: "{}" },
    );
    const response = await route.handle(request, makeGatewayEvents().events);
    expect(response.status).toBe(401);
  });
});
