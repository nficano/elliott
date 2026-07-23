import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  BlueBubblesSettings,
  ToolDefinition,
} from "../../../src/runtime/types";

const MESSAGE_CHUNK_CHARACTERS = 4000;
const HTTP_ERROR_FLOOR = 400;
const GUID_SEPARATOR = ";-;";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.bluebubbles;
  if (settings === undefined) return {};
  if (
    settings.allowedRecipients.length === 0
    && settings.defaultRecipient === undefined
  ) {
    return {};
  }
  return { tools: [sendTool(settings)] };
};

const sendTool = (settings: BlueBubblesSettings): ToolDefinition => ({
  name: "imessage_send",
  description: "Send an iMessage through the paired BlueBubbles server. "
    + "Only allowlisted recipients are reachable; omit `to` for the "
    + "owner's default recipient. Confirm before sending anything "
    + "consequential.",
  inputSchema: objectSchema({
    text: { type: "string", minLength: 1 },
    to: { type: "string" },
  }, ["text"]),
  execute: async (input) => {
    const recipient = resolveRecipient(input, settings);
    const text = requiredString(input, "text");
    for (const chunk of chunkText(text)) {
      await deliverChunk(settings, recipient, chunk);
    }
    return JSON.stringify({ ok: true, to: recipient });
  },
});

const resolveRecipient = (
  input: unknown,
  settings: BlueBubblesSettings,
): string => {
  const requested = isJsonRecord(input) && typeof input["to"] === "string"
      && input["to"].length > 0
    ? input["to"]
    : settings.defaultRecipient;
  if (requested === undefined || requested.length === 0) {
    throw new Error("No recipient: pass `to` or configure a default");
  }
  const allowed = requested === settings.defaultRecipient
    || settings.allowedRecipients.includes(requested);
  if (!allowed) {
    throw new Error(`Recipient ${requested} is not on the sender allowlist`);
  }
  return requested;
};

const deliverChunk = async (
  settings: BlueBubblesSettings,
  recipient: string,
  chunk: string,
): Promise<void> => {
  const url = new URL("/api/v1/message/text", settings.serverUrl);
  url.searchParams.set("password", settings.password);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chatGuid: toChatGuid(recipient),
      tempGuid: `elliott-${crypto.randomUUID()}`,
      message: chunk,
      method: "apple-script",
    }),
  });
  if (!response.ok) {
    throw new Error(`BlueBubbles returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json().catch(() => ({}));
  if (
    isJsonRecord(payload) && typeof payload["status"] === "number"
    && payload["status"] >= HTTP_ERROR_FLOOR
  ) {
    const message = payload["message"];
    throw new Error(
      `BlueBubbles send failed: ${
        typeof message === "string" ? message : "unknown error"
      }`,
    );
  }
};

const toChatGuid = (recipient: string): string =>
  recipient.includes(GUID_SEPARATOR)
    ? recipient
    : `iMessage${GUID_SEPARATOR}${recipient}`;

const chunkText = (text: string): readonly string[] => {
  if (text.length <= MESSAGE_CHUNK_CHARACTERS) return [text];
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < text.length;
    offset += MESSAGE_CHUNK_CHARACTERS
  ) {
    chunks.push(text.slice(offset, offset + MESSAGE_CHUNK_CHARACTERS));
  }
  return chunks;
};
