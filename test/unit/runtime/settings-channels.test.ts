import { describe, expect, it } from "bun:test";
import {
  mcpSettings,
  optionalBlueBubbles,
  optionalGmail,
  optionalGoogle,
  optionalSlack,
} from "../../../src/runtime/settings";

describe("optionalSlack", () => {
  it("stays off until enabled", () => {
    expect(optionalSlack({ channels: { slack: { enabled: false } } })).toEqual(
      {},
    );
  });

  it("loads tokens and optional fields when enabled", () => {
    const settings = optionalSlack(
      {
        channels: {
          slack: {
            enabled: true,
            app_token: "xapp",
            bot_token: "xoxb",
            user_token: "xoxp",
            owner_id: "U1",
            default_channel: "C1",
            reply_in_thread: true,
          },
        },
      },
      { slack_signing_secret: "sig" },
    );
    expect(settings.slack).toEqual({
      appToken: "xapp",
      botToken: "xoxb",
      userToken: "xoxp",
      ownerId: "U1",
      defaultChannel: "C1",
      replyInThread: true,
      signingSecret: "sig",
    });
  });
});

describe("optionalGmail / optionalGoogle", () => {
  it("optionalGmail requires all three secrets", () => {
    expect(optionalGmail({}, { gmail_client_id: "id" })).toEqual({});
    expect(
      optionalGmail(
        { gmail: { pubsub_topic: "t" } },
        {
          gmail_client_id: "id",
          gmail_client_secret: "sec",
          gmail_refresh_token: "rt",
          gmail_webhook_secret: "wh",
        },
      ),
    ).toEqual({
      gmail: {
        clientId: "id",
        clientSecret: "sec",
        refreshToken: "rt",
        webhookSecret: "wh",
        pubsubTopic: "t",
      },
    });
  });

  it("optionalGoogle skips accounts whose refresh token is unresolved", () => {
    expect(
      optionalGoogle(
        {
          google: {
            accounts: [
              { name: "a", refresh_token_secret: "missing" },
              { name: "b", refresh_token_secret: "tok_b", email: "b@x" },
              { bad: true },
              "skip",
            ],
          },
        },
        {
          google_client_id: "cid",
          google_client_secret: "csec",
          tok_b: "refresh-b",
        },
      ),
    ).toEqual({
      google: {
        accounts: [{
          name: "b",
          clientId: "cid",
          clientSecret: "csec",
          refreshToken: "refresh-b",
          email: "b@x",
        }],
      },
    });
  });

  it("falls back to a legacy default Gmail account when no google.accounts", () => {
    expect(
      optionalGoogle({}, {
        gmail_client_id: "id",
        gmail_client_secret: "sec",
        gmail_refresh_token: "rt",
      }),
    ).toEqual({
      google: {
        accounts: [{
          name: "default",
          clientId: "id",
          clientSecret: "sec",
          refreshToken: "rt",
        }],
      },
    });
    expect(optionalGoogle({}, {})).toEqual({});
  });

  it("returns empty when accounts list exists but client secrets do not", () => {
    expect(
      optionalGoogle(
        { google: { accounts: [{ name: "a", refresh_token_secret: "t" }] } },
        { t: "rt" },
      ),
    ).toEqual({});
  });
});

describe("optionalBlueBubbles", () => {
  it("requires enabled + password", () => {
    expect(optionalBlueBubbles({
      channels: { bluebubbles: { enabled: true, server_url: "http://bb" } },
    }, {})).toEqual({});
  });

  it("loads allowlist and optional recipient", () => {
    expect(
      optionalBlueBubbles(
        {
          channels: {
            bluebubbles: {
              enabled: true,
              server_url: "http://bb",
              default_recipient: "+1555",
              allowed_recipients: ["+1555", 1],
            },
          },
        },
        {
          bluebubbles_password: "pw",
          bluebubbles_webhook_secret: "wh",
        },
      ),
    ).toEqual({
      bluebubbles: {
        serverUrl: "http://bb",
        password: "pw",
        defaultRecipient: "+1555",
        allowedRecipients: ["+1555"],
        webhookSecret: "wh",
      },
    });
  });
});

describe("mcpSettings", () => {
  it("filters malformed entries and resolves authorization secrets", () => {
    expect(mcpSettings({}, {})).toEqual([]);
    expect(
      mcpSettings(
        {
          spec: {
            mcp: [
              {
                id: "ha",
                url: "http://ha/mcp",
                transport: "sse",
                authorizationSecret: "tok",
              },
              {
                id: "ok",
                url: "http://ok/mcp",
                transport: "streamable-http",
              },
              { id: "bad", url: "http://x", transport: "stdio" },
              { id: 1, url: "http://x", transport: "sse" },
              "skip",
            ],
          },
        },
        { tok: "Bearer x" },
      ),
    ).toEqual([
      {
        id: "ha",
        url: "http://ha/mcp",
        transport: "sse",
        authorization: "Bearer x",
      },
      { id: "ok", url: "http://ok/mcp", transport: "streamable-http" },
    ]);
  });
});
