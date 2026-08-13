import { afterEach, describe, expect, it, mock } from "bun:test";
import { verifiedRequestToken } from "../../../src/runtime/skills/http";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for gateway-gmail: OAuth token mint, search, and
// the inbound push webhook's token verification. See
// docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("gateway-gmail skill logic (Tier 1)", () => {
  it("stays dormant without gmail OAuth settings", async () => {
    const { context } = await makeSmokeContext({ gmail: undefined });
    const registration = await loadOneSkill("gateway-gmail", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("mints an access token and searches, returning compact rows", async () => {
    stubFetch([
      {
        match: "oauth2.googleapis.com/token",
        body: JSON.stringify({
          access_token: "minted-token",
          expires_in: 3600,
        }),
      },
      {
        match: "/messages?q=",
        body: JSON.stringify({ messages: [{ id: "m1" }] }),
      },
      {
        match: "/messages/m1",
        body: JSON.stringify({
          id: "m1",
          threadId: "t1",
          snippet: "hello",
          payload: {
            headers: [
              { name: "From", value: "sender@example.com" },
              { name: "Subject", value: "Hi there" },
            ],
          },
        }),
      },
    ]);
    const { context } = await makeSmokeContext();
    const tool = toolByName(
      await loadOneSkill("gateway-gmail", context),
      "email_search",
    );
    const rows = JSON.parse(await tool.execute({ query: "from:sender" }));
    expect(rows).toEqual([{
      id: "m1",
      threadId: "t1",
      from: "sender@example.com",
      subject: "Hi there",
      date: "",
      snippet: "hello",
      listUnsubscribe: "",
    }]);
  });

  it("rejects an inbound push whose token does not match", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("gateway-gmail", context);
    const route = registration.routes?.[0];
    if (route === undefined) throw new Error("gmail webhook route missing");
    const request = new Request(
      "http://localhost/v1/gateways/gmail?token=wrong",
      { method: "POST", body: "{}" },
    );
    expect(verifiedRequestToken(request, "gmail-hook")).toBe(false);
    const response = await route.handle(request, {
      onMessage: async () => {},
      onFeedback: async () => {},
      onError: () => {},
    });
    expect(response.status).toBe(401);
  });
});
