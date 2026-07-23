/**
 * Gmail client on the official SDK (`@googleapis/gmail`). Auth is a Vault-held
 * OAuth refresh token (client_id/secret + refresh_token) with the `gmail.modify`
 * scope (a superset of readonly), so the same creds serve read and write. The
 * SDK's OAuth2 client mints + refreshes short-lived access tokens itself — no
 * hand-rolled token dance.
 *
 * Read surface: profile, search, thread, and `analyzeInbox` (the one call the
 * triage tool needs — inbox messages for cleanup + unanswered threads for
 * follow-ups). Write surface: archive (remove INBOX), one-click unsubscribe,
 * create-draft-reply. No sending here — the goal is drafts the owner reviews.
 */
import { auth, gmail } from "@googleapis/gmail";
import type { gmail_v1 } from "@googleapis/gmail";
import type { GmailCreds } from "./email-gmail/types.js";
import type { RawEmail, ThreadCandidate } from "./email-triage/types.js";

const META_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-Id",
  "List-Unsubscribe",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
];

const NOT_FOUND = 404;
const MS_PER_HOUR = 3_600_000;
const MAX_LIST = 500;

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const want = name.toLowerCase();
  return msg.payload?.headers?.find((h) =>
    (h.name ?? "").toLowerCase() === want
  )?.value ?? "";
}

function toRawEmail(msg: gmail_v1.Schema$Message): RawEmail {
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: header(msg, "From"),
    to: header(msg, "To"),
    cc: header(msg, "Cc"),
    subject: header(msg, "Subject"),
    snippet: msg.snippet ?? "",
    listUnsubscribe: header(msg, "List-Unsubscribe"),
    listId: header(msg, "List-Id"),
    precedence: header(msg, "Precedence"),
    autoSubmitted: header(msg, "Auto-Submitted"),
  };
}

// The SDK throws a Gaxios error on non-2xx; recover its HTTP status so the write
// methods can keep their non-throwing `{ ok, status }` contract.
function errorStatus(cause: unknown): number {
  const status =
    (cause as { status?: number; response?: { status?: number; }; })
      ?.status
      ?? (cause as { response?: { status?: number; }; })?.response?.status;
  return typeof status === "number" ? status : 0;
}

export class GmailClient {
  private readonly api: gmail_v1.Gmail;

  constructor(creds: GmailCreds) {
    const oauth = new auth.OAuth2({
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
    });
    oauth.setCredentials({ refresh_token: creds.refresh_token });
    this.api = gmail({ version: "v1", auth: oauth });
  }

  async profileEmail(): Promise<string> {
    const res = await this.api.users.getProfile({ userId: "me" });
    return res.data.emailAddress ?? "";
  }

  /** messages.list → ids for a Gmail search query. */
  private async listIds(
    q: string,
    max: number,
  ): Promise<Array<{ id: string; threadId: string; }>> {
    const res = await this.api.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(max, MAX_LIST),
    });
    return (res.data.messages ?? []).flatMap((
      m,
    ) => (m.id ? [{ id: m.id, threadId: m.threadId ?? "" }] : []));
  }

  private async getMessage(
    id: string,
    format: "metadata" | "full" = "metadata",
  ): Promise<gmail_v1.Schema$Message> {
    const res = await this.api.users.messages.get({
      userId: "me",
      id,
      format,
      ...(format === "metadata" && { metadataHeaders: META_HEADERS }),
    });
    return res.data;
  }

  private async getThreadMessages(
    threadId: string,
  ): Promise<gmail_v1.Schema$Message[]> {
    const res = await this.api.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: META_HEADERS,
    });
    return res.data.messages ?? [];
  }

  /** Public: a search returning compact RawEmail rows (for `email_search`). */
  async search(q: string, max: number): Promise<RawEmail[]> {
    const ids = await this.listIds(q, max);
    const out: RawEmail[] = [];
    for (const { id } of ids.slice(0, max)) {
      try {
        out.push(toRawEmail(await this.getMessage(id)));
      } catch {
        /* skip messages that 404 between list and get */
      }
    }
    return out;
  }

  /** Public: full-ish thread as RawEmail rows oldest→newest (for `email_thread`). */
  async thread(threadId: string): Promise<RawEmail[]> {
    const msgs = await this.getThreadMessages(threadId);
    return msgs.map(toRawEmail);
  }

  /**
   * The triage workhorse: one bounded sweep of the inbox returning (a) messages
   * for the cleanup pass and (b) unanswered-thread candidates for follow-ups.
   */
  async analyzeInbox(opts: {
    selfEmail: string;
    windowDays: number;
    maxMessages: number;
    maxThreads: number;
  }): Promise<{ emails: RawEmail[]; candidates: ThreadCandidate[]; }> {
    const ids = await this.listIds(
      `in:inbox newer_than:${opts.windowDays}d`,
      opts.maxMessages,
    );
    const { emails, threadIds } = await this.collectInbox(ids);
    const self = opts.selfEmail.toLowerCase();
    const candidates: ThreadCandidate[] = [];
    for (const threadId of threadIds.slice(0, opts.maxThreads)) {
      const candidate = await this.threadCandidate(threadId, self);
      if (candidate) candidates.push(candidate);
    }
    return { emails, candidates };
  }

  /** First inbox sweep: RawEmail rows + de-duped thread ids, skipping 404s. */
  private async collectInbox(
    ids: ReadonlyArray<{ id: string; threadId: string; }>,
  ): Promise<{ emails: RawEmail[]; threadIds: string[]; }> {
    const emails: RawEmail[] = [];
    const threadIds: string[] = [];
    const seen = new Set<string>();
    for (const { id, threadId } of ids) {
      try {
        emails.push(toRawEmail(await this.getMessage(id)));
      } catch {
        continue;
      }
      if (threadId && !seen.has(threadId)) {
        seen.add(threadId);
        threadIds.push(threadId);
      }
    }
    return { emails, threadIds };
  }

  /** A thread whose newest message is still inbound → a follow-up candidate. */
  private async threadCandidate(
    threadId: string,
    self: string,
  ): Promise<ThreadCandidate | null> {
    try {
      const msgs = await this.getThreadMessages(threadId);
      if (msgs.length === 0) return null;
      const newest = msgs.at(-1)!;
      const fromSelf = (newest.labelIds ?? []).includes("SENT")
        || header(newest, "From").toLowerCase().includes(self);
      // Only threads still waiting on the owner are candidates.
      if (fromSelf) return null;
      const ageMs = Date.now() - Number(newest.internalDate ?? Date.now());
      return {
        latest: toRawEmail(newest),
        unanswered: true,
        ageHours: Math.max(0, ageMs / MS_PER_HOUR),
      };
    } catch {
      return null;
    }
  }

  // ── write surface (each staged behind the approval gate by email.ts) ──

  /** Archive: drop the INBOX label. */
  async archive(id: string): Promise<{ ok: boolean; status: number; }> {
    try {
      const res = await this.api.users.messages.modify({
        userId: "me",
        id,
        requestBody: { removeLabelIds: ["INBOX"] },
      });
      return { ok: true, status: res.status };
    } catch (error) {
      return { ok: false, status: errorStatus(error) };
    }
  }

  /** RFC 8058 one-click unsubscribe (POST), falling back to GET. mailto: skipped. */
  async unsubscribeOneClick(
    url: string,
  ): Promise<{ ok: boolean; status: number; method: string; }> {
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, status: 0, method: "skipped-non-http" };
    }
    const post = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    if (post.ok) return { ok: true, status: post.status, method: "POST" };
    const get = await fetch(url);
    return { ok: get.ok, status: get.status, method: "GET" };
  }

  /** Create a DRAFT reply threaded onto the original (never sends). */
  async createDraftReply(
    threadId: string,
    body: string,
  ): Promise<{ ok: boolean; status: number; draftId?: string; }> {
    const msgs = await this.getThreadMessages(threadId);
    const latest = msgs.at(-1);
    if (!latest) return { ok: false, status: NOT_FOUND };
    const self = await this.profileEmail();
    const to = header(latest, "From");
    const rawSubject = header(latest, "Subject");
    const subject = /^\s*re:/i.test(rawSubject)
      ? rawSubject
      : `Re: ${rawSubject}`;
    const messageId = header(latest, "Message-Id");
    const mime = [
      `From: ${self}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      ...(messageId
        ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`]
        : []),
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ].join("\r\n");
    const raw = Buffer.from(mime).toString("base64url");
    try {
      const res = await this.api.users.drafts.create({
        userId: "me",
        requestBody: { message: { threadId, raw } },
      });
      return {
        ok: true,
        status: res.status,
        ...(res.data.id && { draftId: res.data.id }),
      };
    } catch (error) {
      return { ok: false, status: errorStatus(error) };
    }
  }
}
