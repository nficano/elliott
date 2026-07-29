import { isJsonRecord, recordArray } from "../../../src/providers/http";
import type {
  GmailClient,
  HistoryAddedMessage,
  MailboxWatch,
  RawEmail,
  TokenSource,
  WriteOutcome,
} from "./types";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const META_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-Id",
  "List-Unsubscribe",
];
const MAX_LIST_RESULTS = 100;
const HTTP_NOT_FOUND = 404;

export const makeGmailClient = (source: TokenSource): GmailClient => {
  const api = makeApi(source);
  return {
    profileEmail: async () => {
      const payload = await api.get("/profile");
      const address = payload["emailAddress"];
      return typeof address === "string" ? address : "";
    },
    search: async (query, max) => {
      const bounded = Math.min(max, MAX_LIST_RESULTS);
      const listing = await api.get(
        `/messages?q=${encodeURIComponent(query)}&maxResults=${bounded}`,
      );
      const ids = recordArray(listing, "messages").flatMap((item) =>
        typeof item["id"] === "string" ? [item["id"]] : []
      );
      const rows: RawEmail[] = [];
      for (const id of ids.slice(0, bounded)) {
        try {
          rows.push(await fetchMeta(api, id));
        } catch {
          continue;
        }
      }
      return rows;
    },
    thread: async (threadId) => {
      const payload = await api.get(metadataPath(`/threads/${threadId}`));
      return recordArray(payload, "messages").map(toRawEmail);
    },
    archive: (id) =>
      api.write(`/messages/${id}/modify`, { removeLabelIds: ["INBOX"] }),
    draftReply: (threadId, body) => draftReply(api, threadId, body),
    unsubscribe: unsubscribeOneClick,
    messageMeta: (id) => fetchMeta(api, id),
    historySince: (startHistoryId) => historySince(api, startHistoryId),
    watch: (pubsubTopic) => mailboxWatch(api, pubsubTopic),
  };
};

const mailboxWatch = async (
  api: ReturnType<typeof makeApi>,
  pubsubTopic: string,
): Promise<MailboxWatch> => {
  const payload = await api.post("/watch", {
    topicName: pubsubTopic,
    labelIds: ["INBOX"],
    labelFilterBehavior: "INCLUDE",
  });
  const historyId = payload["historyId"];
  const expiration = payload["expiration"];
  return {
    historyId: typeof historyId === "string" ? historyId : "",
    expiration: typeof expiration === "string" ? Number(expiration) : 0,
  };
};

const fetchMeta = async (
  api: ReturnType<typeof makeApi>,
  id: string,
): Promise<RawEmail> =>
  toRawEmail(await api.get(metadataPath(`/messages/${id}`)));

// INBOX-only additions after the anchor, deduplicated across history entries.
// A 404 means the anchor is older than what Gmail retains; the caller must
// re-anchor and move on rather than treat it as a failure.
const historySince = async (
  api: ReturnType<typeof makeApi>,
  startHistoryId: string,
): Promise<readonly HistoryAddedMessage[] | undefined> => {
  const query = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
    labelId: "INBOX",
    maxResults: String(MAX_LIST_RESULTS),
  });
  const payload = await api.tryGet(`/history?${query.toString()}`);
  if (payload === undefined) return undefined;
  const added = new Map<string, HistoryAddedMessage>();
  for (const item of recordArray(payload, "history")) {
    for (const entry of recordArray(item, "messagesAdded")) {
      const message = entry["message"];
      if (!isJsonRecord(message)) continue;
      const id = message["id"];
      const threadId = message["threadId"];
      if (typeof id === "string" && typeof threadId === "string") {
        added.set(id, { id, threadId });
      }
    }
  }
  return [...added.values()];
};

const metadataPath = (path: string): string => {
  const headers = META_HEADERS.map((name) => `metadataHeaders=${name}`).join(
    "&",
  );
  return `${path}?format=metadata&${headers}`;
};

const draftReply = async (
  api: ReturnType<typeof makeApi>,
  threadId: string,
  body: string,
): Promise<WriteOutcome> => {
  const thread = await api.get(metadataPath(`/threads/${threadId}`));
  const latest = recordArray(thread, "messages").at(-1);
  if (latest === undefined) return { ok: false, status: HTTP_NOT_FOUND };
  const to = header(latest, "From");
  const rawSubject = header(latest, "Subject");
  const subject = /^\s*re:/i.test(rawSubject)
    ? rawSubject
    : `Re: ${rawSubject}`;
  const messageId = header(latest, "Message-Id");
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    ...(messageId.length > 0
      ? [`In-Reply-To: ${messageId}`, `References: ${messageId}`]
      : []),
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const raw = Buffer.from(mime).toString("base64url");
  const outcome = await api.write("/drafts", {
    message: { threadId, raw },
  });
  return outcome;
};

const unsubscribeOneClick = async (url: string): Promise<WriteOutcome> => {
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, status: 0, method: "skipped-non-https" };
  }
  const post = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  if (post.ok) return { ok: true, status: post.status, method: "POST" };
  const get = await fetch(url);
  return { ok: get.ok, status: get.status, method: "GET" };
};

const getResponse = async (
  source: TokenSource,
  path: string,
): Promise<Response> =>
  fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${await source.token()}` },
  });

const postResponse = async (
  source: TokenSource,
  path: string,
  body: unknown,
): Promise<Response> =>
  fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await source.token()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

const parseRecord = async (
  response: Response,
): Promise<Readonly<Record<string, unknown>>> => {
  if (!response.ok) {
    throw new Error(`Gmail API returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isJsonRecord(payload)) {
    throw new Error("Gmail API returned an invalid payload");
  }
  return payload;
};

const toWriteOutcome = async (response: Response): Promise<WriteOutcome> => {
  const payload: unknown = await response.json().catch(() => ({}));
  const draftId = isJsonRecord(payload) && typeof payload["id"] === "string"
    ? payload["id"]
    : undefined;
  return {
    ok: response.ok,
    status: response.status,
    ...(draftId !== undefined && { draftId }),
  };
};

const makeApi = (source: TokenSource) => ({
  get: async (path: string): Promise<Readonly<Record<string, unknown>>> =>
    parseRecord(await getResponse(source, path)),
  // Like get, but a 404 is a domain answer (absent resource), not an error.
  tryGet: async (
    path: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined> => {
    const response = await getResponse(source, path);
    if (response.status === HTTP_NOT_FOUND) return undefined;
    return parseRecord(response);
  },
  post: async (
    path: string,
    body: unknown,
  ): Promise<Readonly<Record<string, unknown>>> =>
    parseRecord(await postResponse(source, path, body)),
  write: async (path: string, body: unknown): Promise<WriteOutcome> =>
    toWriteOutcome(await postResponse(source, path, body)),
});

const header = (
  message: Readonly<Record<string, unknown>>,
  name: string,
): string => {
  const payload = message["payload"];
  if (!isJsonRecord(payload)) return "";
  const want = name.toLowerCase();
  const match = recordArray(payload, "headers").find((item) =>
    typeof item["name"] === "string" && item["name"].toLowerCase() === want
  );
  const value = match?.["value"];
  return typeof value === "string" ? value : "";
};

const toRawEmail = (message: Readonly<Record<string, unknown>>): RawEmail => ({
  id: typeof message["id"] === "string" ? message["id"] : "",
  threadId: typeof message["threadId"] === "string"
    ? message["threadId"]
    : "",
  from: header(message, "From"),
  to: header(message, "To"),
  cc: header(message, "Cc"),
  subject: header(message, "Subject"),
  date: header(message, "Date"),
  snippet: typeof message["snippet"] === "string" ? message["snippet"] : "",
  listUnsubscribe: header(message, "List-Unsubscribe"),
});
