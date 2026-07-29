import { describe, expect, it } from "bun:test";
import { register } from "../../skills/gateway-bluebubbles/src";
import {
  compactMessage,
  createBlueBubblesClient,
} from "../../skills/gateway-bluebubbles/src/client";
import type { SkillContext } from "../../src/runtime/skills/types";
import type { BlueBubblesSettings } from "../../src/runtime/types";

const SETTINGS: BlueBubblesSettings = {
  serverUrl: "http://127.0.0.1:1234",
  password: "secret",
  allowedRecipients: [],
};

const RECENT_MESSAGE = {
  guid: "MSG-1",
  text: "Dinner's almost ready",
  isFromMe: false,
  dateCreated: 1_785_275_000_019,
  handle: { address: "+13474062025" },
  chats: [{ chatIdentifier: "+13474062025", displayName: "Mom" }],
};

const MOM_CHAT = {
  guid: "any;-;+13474062025",
  chatIdentifier: "+13474062025",
  displayName: "Mom",
  participants: [{ address: "+13474062025" }],
};

const CHAT_MESSAGE = {
  guid: "MSG-2",
  text: "omw",
  isFromMe: true,
  dateCreated: 1_785_275_100_000,
};

const MOM_GUID = "any;-;+13474062025";

const requestUrl = (input: string | URL | Request): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input.toString());

// A fetcher that records every call and answers each BlueBubbles endpoint from
// canned data, so the client's real query/resolve logic is exercised offline.
// Only Mom's 1:1 chat GUID has messages; other chat GUIDs 404, so candidate
// probing has to land on the right one.
const recordingFetcher = (log: string[]): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = requestUrl(input);
    log.push(url.pathname);
    if (url.pathname === "/api/v1/message/query") {
      return Response.json({ status: 200, data: [RECENT_MESSAGE] });
    }
    if (url.pathname === "/api/v1/chat/query") {
      return Response.json({ status: 200, data: [MOM_CHAT] });
    }
    if (
      url.pathname === `/api/v1/chat/${encodeURIComponent(MOM_GUID)}/message`
    ) {
      return Response.json({ status: 200, data: [CHAT_MESSAGE] });
    }
    if (url.pathname.endsWith("/message")) {
      return new Response("not found", { status: 404 });
    }
    return Response.json({ status: 404, data: [] });
  }) as typeof fetch;

const context = (settings: BlueBubblesSettings): SkillContext =>
  ({ settings: { bluebubbles: settings } }) as unknown as SkillContext;

describe("BlueBubbles iMessage read", () => {
  it("registers read without a recipient allowlist, send only with one", () => {
    const readOnly = register(context(SETTINGS)).tools ?? [];
    expect(readOnly.map((tool) => tool.name)).toEqual(["imessage_read"]);

    const withSend = register(
      context({ ...SETTINGS, allowedRecipients: ["+15555550100"] }),
    ).tools ?? [];
    expect(withSend.map((tool) => tool.name)).toEqual([
      "imessage_read",
      "imessage_send",
    ]);
  });

  it("reads recent messages across every conversation", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const messages = (await client.queryRecent(20)).map(compactMessage);
    expect(log).toEqual(["/api/v1/message/query"]);
    expect(messages).toEqual([{
      from: "+13474062025",
      fromMe: false,
      text: "Dinner's almost ready",
      at: new Date(1_785_275_000_019).toISOString(),
      chat: "Mom",
    }]);
  });

  it("reads a phone handle via its direct 1:1 GUID, no chat-list scan", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const found = await client.readFrom("+13474062025", 20);
    // The 1:1 GUID is hit directly; chat/query is never consulted.
    expect(log).toEqual([
      `/api/v1/chat/${encodeURIComponent(MOM_GUID)}/message`,
    ]);
    expect(found?.name).toBe("+13474062025");
    expect(found?.messages.map(compactMessage)[0]).toMatchObject({
      from: "me",
      text: "omw",
    });
  });

  it("matches a phone number across formatting and country code", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    // "(347) 406-2025" -> +13474062025 candidate; the +3474062025 candidate 404s.
    expect((await client.readFrom("(347) 406-2025", 20))?.messages)
      .toHaveLength(
        1,
      );
    expect(await client.readFrom("3474062025", 20)).toBeDefined();
  });

  it("falls back to the chat list for a contact name", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const found = await client.readFrom("Mom", 20);
    expect(log).toEqual([
      "/api/v1/chat/query",
      `/api/v1/chat/${encodeURIComponent(MOM_GUID)}/message`,
    ]);
    expect(found?.name).toBe("Mom");
    expect(found?.messages.map(compactMessage)[0]).toMatchObject({
      from: "me",
    });
  });

  it("prefers the direct 1:1 thread over a group the handle is only in", async () => {
    // chat/query returns only groups (the real server caps and mis-sorts the
    // list, dropping the 1:1). Reading by handle must still land on the 1:1,
    // because it targets the constructed GUID rather than scanning.
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const found = await client.readFrom("+13474062025", 20);
    expect(found?.messages.map(compactMessage)[0]).toMatchObject({
      from: "me",
    });
    expect(log).not.toContain("/api/v1/chat/query");
  });

  it("uses a full chat GUID directly without a chat lookup", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const found = await client.readFrom("iMessage;-;+15551234567", 20);
    expect(found?.name).toBe("iMessage;-;+15551234567");
    expect(log).toEqual([
      `/api/v1/chat/${encodeURIComponent("iMessage;-;+15551234567")}/message`,
    ]);
  });

  it("returns undefined when no conversation matches", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    expect(await client.readFrom("nobody@nowhere.test", 20)).toBeUndefined();
  });

  it("labels attachment-only messages and sent messages", () => {
    expect(compactMessage({
      isFromMe: true,
      dateCreated: 1_785_275_100_000,
      attachments: [{ id: "a" }, { id: "b" }],
    })).toMatchObject({ from: "me", fromMe: true, text: "[2 attachments]" });
  });
});
