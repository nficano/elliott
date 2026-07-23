import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { SmtpSettings, ToolDefinition } from "../../../src/runtime/types";
import { sendMail } from "./smtp";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.smtp;
  return settings === undefined ? {} : { tools: [sendTool(settings)] };
};

const sendTool = (settings: SmtpSettings): ToolDefinition => ({
  name: "email_send",
  description: "Send a plain-text email over SMTP from the owner's "
    + "configured address. Only allowlisted recipients are reachable. "
    + "Confirm with the owner before sending anything consequential.",
  inputSchema: objectSchema({
    to: { type: "string" },
    subject: { type: "string", minLength: 1 },
    body: { type: "string", minLength: 1 },
  }, ["to", "subject", "body"]),
  execute: async (input) => {
    const to = requiredString(input, "to").toLowerCase();
    const allowed = settings.allowedRecipients.some(
      (recipient) => recipient.toLowerCase() === to,
    );
    if (!allowed) {
      throw new Error(`Recipient ${to} is not on the sender allowlist`);
    }
    await sendMail(settings, {
      to,
      subject: requiredString(input, "subject"),
      body: requiredString(input, "body"),
    });
    return JSON.stringify({ ok: true, to });
  },
});
