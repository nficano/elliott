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

const requestUrl = (input: string | URL | Request): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input.toString());

// A fetcher that records every call and answers each BlueBubbles endpoint from
// canned data, so the client's real query/resolve logic is exercised offline.
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
    if (url.pathname.endsWith("/message")) {
      return Response.json({ status: 200, data: [CHAT_MESSAGE] });
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

  it("resolves a conversation by contact name and reads the real chat GUID", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const chat = await client.resolveChat("Mom");
    expect(chat).toEqual({ guid: "any;-;+13474062025", name: "Mom" });
    const messages = (await client.queryChat(chat?.guid ?? "", 20))
      .map(compactMessage);
    expect(log).toEqual([
      "/api/v1/chat/query",
      `/api/v1/chat/${encodeURIComponent("any;-;+13474062025")}/message`,
    ]);
    expect(messages[0]).toMatchObject({ from: "me", text: "omw" });
  });

  it("matches a phone number across formatting and country code", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    expect(await client.resolveChat("(347) 406-2025")).toEqual({
      guid: "any;-;+13474062025",
      name: "Mom",
    });
    expect(await client.resolveChat("3474062025")).toBeDefined();
  });

  it("uses a full chat GUID directly without a chat lookup", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    const chat = await client.resolveChat("iMessage;-;+15551234567");
    expect(chat).toEqual({
      guid: "iMessage;-;+15551234567",
      name: "iMessage;-;+15551234567",
    });
    expect(log).toEqual([]);
  });

  it("does not match an unrelated handle", async () => {
    const log: string[] = [];
    const client = createBlueBubblesClient(SETTINGS, recordingFetcher(log));
    expect(await client.resolveChat("nobody@nowhere.test")).toBeUndefined();
  });

  it("labels attachment-only messages and sent messages", () => {
    expect(compactMessage({
      isFromMe: true,
      dateCreated: 1_785_275_100_000,
      attachments: [{ id: "a" }, { id: "b" }],
    })).toMatchObject({ from: "me", fromMe: true, text: "[2 attachments]" });
  });
});
