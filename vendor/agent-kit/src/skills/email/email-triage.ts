/**
 * Email triage — pure helpers (§17 email-read). Turns raw Gmail message
 * metadata into the two things the owner asked for:
 *
 *   1. CLEANUP — automated noise safe to clear: policy/ToS updates, review
 *      solicitations, marketing, and *duplicated* platform notifications (the
 *      "We're validating your Core Web Vitals fixes for site X" sent once per
 *      request). Grouped by sender, with duplicate clusters collapsed so five
 *      near-identical notices read as one line, not five.
 *
 *   2. FOLLOWUPS — individual people waiting on a reply, with the context the owner
 *      wanted factored in: is the sender a real person or a business, was it a
 *      forward, was he only cc'd, and (via followup-judgment) is it even worth a
 *      nudge. No I/O here — the Gmail fetch lives in email-gmail.ts.
 */
import type {
  Bucket,
  CleanupItem,
  CleanupKind,
  FollowupItem,
  RawEmail,
  ThreadCandidate,
} from "./email-triage/types.js";
import { analyzeAsk, followupWorthiness } from "./followup-judgment.js";
import type { RecipientRole, SenderKind } from "./followup-judgment/types.js";

// Markers that appear ANYWHERE in a local-part and give away a machine sender,
// even with prefixes/suffixes (sc-noreply, noreply-123, notifications+x).
const MACHINE_SUBSTR =
  /(no-?reply|do-?not-?reply|donotreply|notifications?|mailer|mailer-daemon|bounce|postmaster|auto-?(reply|responder|generated)|automated|drive-shares?|calendar-notification)/i;
// Whole-local-part role accounts ("info", "team", "billing", …) — exact match so
// they don't false-positive inside a person's name.
const ROLE_EXACT =
  /^(notify|alerts?|newsletter|news|updates?|digest|team|hello|hi|info|support|help|billing|invoices?|receipts?|orders?|order|account|accounts|admin|system|root|marketing|sales|promo|promotions?|offers?|deals?|community|social|email|mail|contact|feedback|survey|notification|comms|members?)$/i;

function isMachineLocalPart(lp: string): boolean {
  return MACHINE_SUBSTR.test(lp) || ROLE_EXACT.test(lp) || /\d{3,}/.test(lp);
}

const POLICY_RE =
  /\b(privacy policy|terms of (service|use)|terms (and|&) conditions|user agreement|cookie policy|updated? (our )?(terms|policy|policies)|policy (update|change)|changes to (our )?(terms|policy|policies)|we('| ha)ve updated our|update to our (terms|privacy|policy))\b/i;

const REVIEW_RE =
  /\b(leave (us )?a review|write (us )?a review|rate (your|us|this|our)|how did we do|share your (feedback|experience)|tell us (how|what|about)|your (recent )?(experience|visit|order|purchase)|star rating|review your (recent )?(order|purchase|visit|experience)|we'?d love your feedback)\b/i;

// The `>`-excluded / disjoint-class quantifiers below are linear; the analyzer's
// super-linear warning is a false positive, so these are hoisted + suppressed once.
// eslint-disable-next-line sonarjs/super-linear-regex
const ANGLE_ADDR_RE = /<([^>]+)>/;
// eslint-disable-next-line sonarjs/super-linear-regex
const FORWARD_BODY_RE = /-{3,}\s*forwarded message|begin forwarded message/i;
const LIST_UNSUB_RE = /<(https?:\/\/[^>]+)>/;
const MAX_SAMPLE_SUBJECTS = 4;

export function extractEmailAddress(header: string): string {
  const m = ANGLE_ADDR_RE.exec(header);
  return (m?.[1] ?? header).trim().toLowerCase();
}

export function localPart(addr: string): string {
  return addr.split("@", 1)[0] ?? "";
}

export function domainOf(addr: string): string {
  return addr.split("@", 2)[1] ?? "";
}

/** Human local-parts keep per-person identity; machine ones collapse to domain. */
export function normalizeSender(fromHeader: string): string {
  const addr = extractEmailAddress(fromHeader);
  const lp = localPart(addr);
  if (isMachineLocalPart(lp)) return domainOf(addr) || addr;
  return addr;
}

export function senderKind(e: RawEmail): SenderKind {
  const lp = localPart(extractEmailAddress(e.from));
  const machine = isMachineLocalPart(lp);
  const autoSub = e.autoSubmitted !== "" && !/^\s*no\b/i.test(e.autoSubmitted);
  const bulkPrec = /\b(bulk|list|junk|auto_reply)\b/i.test(e.precedence);
  if (machine || autoSub || bulkPrec) return "automated";
  if (e.listUnsubscribe !== "" || e.listId !== "") return "business";
  return "individual";
}

export function recipientRole(e: RawEmail, selfEmail: string): RecipientRole {
  const self = selfEmail.toLowerCase();
  if (e.to.toLowerCase().includes(self)) return "direct";
  if (e.cc.toLowerCase().includes(self)) return "cc";
  return "group";
}

export function isForwarded(e: RawEmail): boolean {
  return (
    /^\s*(fwd?|fw):/i.test(e.subject)
    || FORWARD_BODY_RE.test(e.snippet)
  );
}

export function isPolicyUpdate(e: RawEmail): boolean {
  return POLICY_RE.test(e.subject) || POLICY_RE.test(e.snippet);
}

export function isReviewRequest(e: RawEmail): boolean {
  return REVIEW_RE.test(e.subject) || REVIEW_RE.test(e.snippet);
}

/** Collapse a subject to a template so per-item automated notices cluster. */
export function subjectTemplate(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^\s*(re|fwd?|fw):\s*/i, "")
    .replaceAll(/https?:\/\/\S+/g, "")
    .replaceAll(/\b[\w.-]+\.(com|org|io|net|co|edu|gov|dev|app|ai)\b/g, "") // strip domains/site names
    .replaceAll(/["'“”‘’]/g, "")
    .replaceAll(/\d+/g, "#") // digits → #
    .replaceAll(/[^\w\s#]/g, " ") // punctuation → space
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function parseListUnsubscribeUrl(header: string): string | null {
  const m = LIST_UNSUB_RE.exec(header);
  return m?.[1] ?? null;
}

/** Which cleanup bucket (if any) an inbox message falls into. Individuals and
 *  genuine one-off business mail return null — never auto-cleanup a person. */
export function cleanupKind(e: RawEmail): CleanupKind | null {
  if (isPolicyUpdate(e)) return "policy_update";
  if (isReviewRequest(e)) return "review_request";
  const kind = senderKind(e);
  if (kind === "individual") return null;
  if (kind === "automated") return "automated_noise";
  // business (bulk sender, human-ish local-part) with an unsubscribe → marketing.
  if (e.listUnsubscribe !== "" || e.listId !== "") return "marketing";
  return null;
}

/** Group inbox noise into per-(sender,kind) cleanup items, collapsing duplicate
 *  subject clusters (the "sent 5 times" case) into one flagged entry. */
export function buildCleanup(emails: readonly RawEmail[]): CleanupItem[] {
  const buckets = new Map<string, Bucket>();
  for (const e of emails) {
    const kind = cleanupKind(e);
    if (!kind) continue;
    const sender = normalizeSender(e.from);
    const key = `${kind}\0${sender}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        kind,
        sender,
        emailIds: [],
        subjects: [],
        templates: new Set(),
        listUnsubscribeUrl: null,
      };
      buckets.set(key, b);
    }
    b.emailIds.push(e.id);
    if (b.subjects.length < MAX_SAMPLE_SUBJECTS) b.subjects.push(e.subject);
    b.templates.add(subjectTemplate(e.subject));
    if (!b.listUnsubscribeUrl && e.listUnsubscribe !== "") {
      b.listUnsubscribeUrl = parseListUnsubscribeUrl(e.listUnsubscribe);
    }
  }
  return [...buckets.values()]
    .map((b) => ({
      kind: b.kind,
      sender: b.sender,
      emailIds: b.emailIds,
      count: b.emailIds.length,
      sampleSubjects: b.subjects,
      listUnsubscribeUrl: b.listUnsubscribeUrl,
      // ≥2 messages that collapse to fewer distinct subject templates = a cluster.
      duplicateCluster: b.emailIds.length >= 2
        && b.templates.size < b.emailIds.length,
    }))
    .sort((a, z) => z.count - a.count);
}

/** Turn unanswered-thread candidates into scored follow-up items. Returns every
 *  candidate (with its worthiness reason) so the read agent has full context;
 *  worthy ones sort first. */
export function buildFollowups(
  candidates: readonly ThreadCandidate[],
  selfEmail: string,
): FollowupItem[] {
  const items = candidates.map((c) => {
    const e = c.latest;
    const kind = senderKind(e);
    const role = recipientRole(e, selfEmail);
    const ask = analyzeAsk(e.snippet);
    const worthiness = followupWorthiness({
      channel: "email",
      signals: ask,
      ageHours: c.ageHours,
      senderKind: kind,
      recipientRole: role,
      unanswered: c.unanswered,
    });
    return {
      threadId: e.threadId,
      from: e.from,
      senderKind: kind,
      recipientRole: role,
      forwarded: isForwarded(e),
      subject: e.subject,
      snippet: e.snippet,
      ageHours: c.ageHours,
      ask,
      worthiness,
    };
  });
  return items.sort((a, z) =>
    Number(z.worthiness.suggest) - Number(a.worthiness.suggest)
  );
}
