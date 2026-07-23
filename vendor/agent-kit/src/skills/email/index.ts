/**
 * skills/email (§17) — Gmail inbox triage + personal follow-ups. The read/write
 * pair (email-read = untrusted ingest, no writes; email-write = archive/
 * unsubscribe/draft, gated), disabled by default (§5); the consumer supplies the
 * Gmail OAuth creds (client_id/secret + refresh_token, gmail.modify scope) via
 * config. `followup-judgment` is shared with other comms skills (e.g. iMessage)
 * and re-exported here.
 */
import type { Registrable } from "../../host/registry/types.js";
import { emailReadSkill } from "./email-read.js";
import { emailWriteSkill } from "./email-write.js";

export { GmailClient } from "./email-gmail.js";
export type { GmailCreds } from "./email-gmail/types.js";
export { emailReadSkill } from "./email-read.js";
export { buildCleanup, buildFollowups } from "./email-triage.js";
export type {
  CleanupItem,
  FollowupItem,
  RawEmail,
  ThreadCandidate,
} from "./email-triage/types.js";
export { emailWriteSkill } from "./email-write.js";
export { analyzeAsk, followupWorthiness } from "./followup-judgment.js";
export type {
  AskKind,
  AskSignals,
  RecipientRole,
  SenderKind,
  Worthiness,
} from "./followup-judgment/types.js";

/** The email read/write pair as a pack (mirrors opsPack/webPack). */
export function emailPack(): Registrable[] {
  return [emailReadSkill(), emailWriteSkill()];
}
