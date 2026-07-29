import { isJsonRecord } from "../../../../src/providers/http";
import {
  objectSchema,
  optionalInteger,
  requiredString,
} from "../../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../../src/runtime/skills/types";
import type {
  BlueBubblesSettings,
  ToolDefinition,
} from "../../../../src/runtime/types";
import { compactMessage, createBlueBubblesClient } from "./client";
import {
  bluebubblesReplyGateway,
  bluebubblesWebhookRoute,
  webhookEnabled,
} from "./webhook";

const READ_LIMIT_DEFAULT = 20;
const READ_LIMIT_MAX = 50;

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.bluebubbles;
  if (settings === undefined) return {};
  const tools: ToolDefinition[] = [readTool(settings)];
  if (
    settings.allowedRecipients.length > 0
    || settings.defaultRecipient !== undefined
  ) {
    tools.push(sendTool(settings));
  }
  if (!webhookEnabled(settings)) return { tools };
  return {
    tools,
    routes: [bluebubblesWebhookRoute(settings, context)],
    gateways: [bluebubblesReplyGateway(settings)],
  };
};

const readTool = (settings: BlueBubblesSettings): ToolDefinition => ({
  name: "imessage_read",
  description: "Read recent iMessages from the paired BlueBubbles server. "
    + "Omit `from` for the most recent messages across every conversation, "
    + "or pass `from` (a phone number, email, contact name, or full chat "
    + "GUID) to read one conversation. Returns messages newest-first.",
  inputSchema: objectSchema({
    from: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: READ_LIMIT_MAX },
  }, []),
  resultRetention: "turn",
  execute: async (input) => {
    const client = createBlueBubblesClient(settings);
    const limit = optionalInteger(input, "limit", {
      min: 1,
      max: READ_LIMIT_MAX,
      fallback: READ_LIMIT_DEFAULT,
    });
    const target = optionalString(input, "from");
    if (target === undefined) {
      const messages = await client.queryRecent(limit);
      return JSON.stringify({ messages: messages.map(compactMessage) });
    }
    const found = await client.readFrom(target, limit);
    if (found === undefined) {
      return JSON.stringify({
        messages: [],
        note: `No conversation matched "${target}".`,
      });
    }
    return JSON.stringify({
      chat: found.name,
      messages: found.messages.map(compactMessage),
    });
  },
});

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
    await createBlueBubblesClient(settings).sendText(recipient, text);
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

const optionalString = (input: unknown, key: string): string | undefined => {
  if (!isJsonRecord(input)) return undefined;
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
