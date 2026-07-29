import {
  isJsonRecord,
  nestedRecord,
  recordArray,
} from "../../../src/providers/http";
import type { BlueBubblesSettings } from "../../../src/runtime/types";
import type {
  BlueBubblesClient,
  BlueBubblesJson,
  BlueBubblesRequest,
  ConversationRead,
  ResolvedChat,
} from "./types";

const CHAT_SCAN_LIMIT = 1000;
const MIN_SUFFIX_DIGITS = 7;
const US_LOCAL_DIGITS = 10;

// A thin BlueBubbles REST client. `fetcher` defaults to global fetch and is
// injected in tests. Reads are unrestricted by design (any conversation); the
// sender allowlist that gates sending lives in the tool layer, not here.
export const createBlueBubblesClient = (
  settings: BlueBubblesSettings,
  fetcher: typeof fetch = fetch,
): BlueBubblesClient => {
  const call = (spec: BlueBubblesRequest): Promise<BlueBubblesJson> =>
    request(settings, fetcher, spec);
  return {
    queryRecent: async (limit) =>
      recordArray(
        await call({
          method: "POST",
          path: "/api/v1/message/query",
          body: { limit, offset: 0, with: ["chat", "handle"], sort: "DESC" },
        }),
        "data",
      ),
    readFrom: (target, limit) => readConversation(call, target, limit),
  };
};

// Resolve which conversation `target` names, then read it. A phone/email is
// turned into its 1:1 chat GUID (`any;-;<address>`) and read directly — the
// reliable path, since the server's chat list is capped and mis-sorted and can
// omit the very chat we want. Only a name (or a candidate that finds nothing)
// falls back to scanning that list, which is where group/display-name matches
// live. A full GUID is read as-is.
const readConversation = async (
  call: (spec: BlueBubblesRequest) => Promise<BlueBubblesJson>,
  target: string,
  limit: number,
): Promise<ConversationRead | undefined> => {
  if (target.includes(";-;")) {
    return { name: target, messages: await chatMessages(call, target, limit) };
  }
  for (const guid of guidCandidates(target)) {
    const messages = await chatMessages(call, guid, limit);
    if (messages.length > 0) return { name: target, messages };
  }
  const scanned = await scanForChat(call, target);
  if (scanned === undefined) return undefined;
  const messages = await chatMessages(call, scanned.guid, limit);
  return { name: scanned.name, messages };
};

// 1:1 chat GUIDs the target could name. A phone yields the E.164 forms most
// handles are stored as (US "+1…" from a 10-digit number, "+" + digits, and the
// raw input); an email yields its single form. A name yields none.
const guidCandidates = (target: string): readonly string[] => {
  if (target.includes("@")) return [`any;-;${target}`];
  const digits = target.replaceAll(/\D/g, "");
  if (digits.length < MIN_SUFFIX_DIGITS) return [];
  const addresses = new Set<string>();
  if (digits.length === US_LOCAL_DIGITS) addresses.add(`+1${digits}`);
  addresses.add(`+${digits}`);
  addresses.add(target);
  return [...addresses].map((address) => `any;-;${address}`);
};

const chatMessages = async (
  call: (spec: BlueBubblesRequest) => Promise<BlueBubblesJson>,
  guid: string,
  limit: number,
): Promise<readonly BlueBubblesJson[]> =>
  recordArray(
    await call({
      method: "GET",
      path: `/api/v1/chat/${encodeURIComponent(guid)}/message`,
      query: { limit: String(limit), with: "handle", sort: "DESC" },
    }),
    "data",
  );

const request = async (
  settings: BlueBubblesSettings,
  fetcher: typeof fetch,
  spec: BlueBubblesRequest,
): Promise<BlueBubblesJson> => {
  const url = new URL(spec.path, settings.serverUrl);
  url.searchParams.set("password", settings.password);
  for (const [key, value] of Object.entries(spec.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetcher(url, {
    method: spec.method,
    ...(spec.body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec.body),
    }),
  });
  // Non-OK responses (notably 404 for an absent chat, which candidate probing
  // relies on) carry a JSON body with no `data`, so callers see empty results.
  // Only a rejected fetch — a genuinely unreachable server — throws.
  const payload: unknown = await response.json().catch(() => ({}));
  return isJsonRecord(payload) ? payload : {};
};

// Fallback for name targets: scan the (capped) chat list. Prefer a chat whose
// own identity matches — the 1:1 whose chatIdentifier IS the handle, or a group
// named for the target — over one where the target is merely a participant, so
// "read from Alice" does not surface a group Alice happens to be in.
const scanForChat = async (
  call: (spec: BlueBubblesRequest) => Promise<BlueBubblesJson>,
  target: string,
): Promise<ResolvedChat | undefined> => {
  const payload = await call({
    method: "POST",
    path: "/api/v1/chat/query",
    body: {
      limit: CHAT_SCAN_LIMIT,
      offset: 0,
      with: ["participants"],
      sort: "lastmessage",
    },
  });
  const chats = recordArray(payload, "data");
  const match = chats.find((chat) => directMatch(chat, target))
    ?? chats.find((chat) => participantMatch(chat, target));
  return match === undefined ? undefined : {
    guid: stringField(match, "guid") ?? target,
    name: chatName(match),
  };
};

export const compactMessage = (message: BlueBubblesJson): BlueBubblesJson => {
  const fromMe = message["isFromMe"] === true;
  const handle = nestedRecord(message, "handle");
  const address = handle === undefined
    ? undefined
    : stringField(handle, "address");
  return {
    from: fromMe ? "me" : (address ?? "unknown"),
    fromMe,
    text: messageBody(message),
    at: timestamp(message["dateCreated"]),
    ...chatLabel(message),
  };
};

const directMatch = (chat: BlueBubblesJson, target: string): boolean => {
  const lowerTarget = target.toLowerCase();
  const identifier = stringField(chat, "chatIdentifier") ?? "";
  const display = stringField(chat, "displayName") ?? "";
  return display.toLowerCase().includes(lowerTarget)
    || identifier.toLowerCase().includes(lowerTarget)
    || identifiersMatch(identifier, target);
};

const participantMatch = (chat: BlueBubblesJson, target: string): boolean => {
  const lowerTarget = target.toLowerCase();
  return recordArray(chat, "participants").some((participant) => {
    const address = stringField(participant, "address") ?? "";
    return address.toLowerCase().includes(lowerTarget)
      || identifiersMatch(address, target);
  });
};

const chatName = (chat: BlueBubblesJson): string => {
  const display = stringField(chat, "displayName");
  if (display !== undefined && display.length > 0) return display;
  const participants = recordArray(chat, "participants")
    .map((participant) => stringField(participant, "address"))
    .filter((address): address is string => address !== undefined);
  if (participants.length > 0) return participants.join(", ");
  return stringField(chat, "chatIdentifier") ?? "unknown";
};

const messageBody = (message: BlueBubblesJson): string => {
  const text = stringField(message, "text");
  if (text !== undefined && text.length > 0) return text;
  const attachments = recordArray(message, "attachments").length;
  if (attachments === 0) return "";
  return `[${attachments} attachment${attachments === 1 ? "" : "s"}]`;
};

const chatLabel = (message: BlueBubblesJson): { readonly chat?: string; } => {
  const chat = recordArray(message, "chats")[0];
  return chat === undefined ? {} : { chat: chatName(chat) };
};

const stringField = (
  value: BlueBubblesJson,
  key: string,
): string | undefined => {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

const normalizeIdentifier = (value: string): string =>
  value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();

// Match handles across formatting differences: "(347) 406-2025",
// "+13474062025", and "3474062025" should all resolve to the same chat. Equal
// normalized forms match; longer numbers match on a shared 7+ digit suffix so a
// country-code prefix does not defeat the lookup. Emails fall back to equality.
const identifiersMatch = (left: string, right: string): boolean => {
  const a = normalizeIdentifier(left);
  const b = normalizeIdentifier(right);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (a.length >= MIN_SUFFIX_DIGITS && b.length >= MIN_SUFFIX_DIGITS) {
    return a.endsWith(b) || b.endsWith(a);
  }
  return false;
};

const timestamp = (value: unknown): string | undefined =>
  typeof value === "number" ? new Date(value).toISOString() : undefined;
