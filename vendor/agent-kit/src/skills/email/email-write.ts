import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef, ToolMeta } from "../../core/agent/types.js";
import { ApprovalDeliverSvc, ApprovalSvc } from "../../core/di/services.js";
import type {
  Manifest,
  PromptFragment,
  Registrable,
} from "../../host/registry/types.js";
import { withApprovalGate } from "../../plugins/trust/approval-gate.js";
import { GmailClient } from "./email-gmail.js";
import { creds, CredsSchema, emailMeta } from "./email-shared.js";
import type { WriteCfg } from "./types.js";

const MAX_ARCHIVE_IDS = 200;

export const WriteConfig = Schema.StructWithRest(
  Schema.Struct({ ...CredsSchema }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

const writeManifest: Manifest<WriteCfg> = {
  id: "email-write",
  kind: "agent",
  version: "0.1.0",
  configSchema: WriteConfig,
  bundle: "comms",
  trust: "write",
  defaultTier: "fast",
  capabilities: ["reads:email", "writes:email"],
  contracts: {
    tools: ["email_archive", "email_unsubscribe", "email_draft_reply"],
  },
};

const WRITE_FRAGMENT: PromptFragment = {
  id: "email-write-guidance",
  text: [
    "## email actions (staged for approval)",
    "- `email_archive` — remove messages from the inbox (reversible). Batch the",
    "  emailIds from a cleanup group; state the sender + count before staging.",
    "- `email_unsubscribe` — RFC 8058 one-click on a sender's list URL.",
    "- `email_draft_reply` — write the reply in the owner's voice (terse, direct,",
    "  no filler) and save it as a DRAFT to review and send. It NEVER sends.",
  ].join("\n"),
};

function archiveTool(gmail: GmailClient, meta: ToolMeta): ToolDef {
  return define({
    name: "email_archive",
    description:
      "Archive one or more messages (removes the INBOX label — reversible). Pass emailIds from a "
      + "cleanup group. Staged for approval.",
    schema: Schema.Struct({
      emailIds: Schema.Array(Schema.String).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(MAX_ARCHIVE_IDS),
      ),
    }),
    meta,
    run: async (a) => {
      const results = [];
      for (const id of a.emailIds) {
        try {
          results.push({ id, ...(await gmail.archive(id)) });
        } catch (error) {
          results.push({ id, ok: false, error: String(error) });
        }
      }
      return JSON.stringify({
        archived: results.filter((r) => r.ok).length,
        results,
      });
    },
  });
}

function unsubscribeTool(gmail: GmailClient, meta: ToolMeta): ToolDef {
  return define({
    name: "email_unsubscribe",
    description:
      "One-click unsubscribe (RFC 8058) at a sender's List-Unsubscribe URL. Staged for approval.",
    schema: Schema.Struct({ listUnsubscribeUrl: Schema.String }),
    meta,
    run: async (a) => {
      try {
        return JSON.stringify(
          await gmail.unsubscribeOneClick(a.listUnsubscribeUrl),
        );
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) });
      }
    },
  });
}

function draftReplyTool(gmail: GmailClient, meta: ToolMeta): ToolDef {
  return define({
    name: "email_draft_reply",
    description:
      "Save a DRAFT reply (never sends) threaded onto an email, addressed to the original sender. "
      + "Write the body yourself in the owner's voice. Staged for approval; the owner reviews and sends.",
    schema: Schema.Struct({
      threadId: Schema.String,
      body: Schema.String.check(Schema.isMinLength(1)),
    }),
    meta,
    run: async (a) => {
      try {
        return JSON.stringify(await gmail.createDraftReply(a.threadId, a.body));
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error) });
      }
    },
  });
}

export function emailWriteSkill(): Registrable<WriteCfg> {
  return {
    manifest: writeManifest,
    async activate(ctx) {
      const gmail = new GmailClient(creds(ctx.config));
      const meta = emailMeta("email-write", true);
      const tools = [
        archiveTool(gmail, meta),
        unsubscribeTool(gmail, meta),
        draftReplyTool(gmail, meta),
      ].map((tool): ToolDef => {
        let gated: ToolDef | undefined;
        return {
          ...tool,
          execute: (args, toolCtx) => {
            gated ??= withApprovalGate({
              tool,
              gate: ctx.get(ApprovalSvc),
              deliverApproval: ctx.get(ApprovalDeliverSvc),
            });
            return gated.execute(args, toolCtx);
          },
        };
      });
      return { tools, promptFragment: WRITE_FRAGMENT };
    },
  };
}
