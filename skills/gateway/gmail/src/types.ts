export interface TokenSource {
  token(): Promise<string>;
}

export interface RawEmail {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly subject: string;
  readonly date: string;
  readonly snippet: string;
  readonly listUnsubscribe: string;
}

export interface WriteOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly draftId?: string;
  readonly method?: string;
}

export interface HistoryAddedMessage {
  readonly id: string;
  readonly threadId: string;
}

export interface PushNotification {
  readonly messageId: string;
  readonly emailAddress: string;
  readonly historyId: string;
}

// The last Gmail historyId each mailbox was reconciled to, durable across
// restarts so a redeployment does not replay or drop notifications.
export interface AnchorStore {
  get(email: string): Promise<string | undefined>;
  set(email: string, historyId: string): Promise<void>;
  setIfAbsent(email: string, historyId: string): Promise<void>;
}

export interface GmailWebhookOptions {
  readonly secret: string;
  readonly gmail: GmailClient;
  readonly anchors: AnchorStore;
}

export interface GmailWatchOptions {
  readonly gmail: GmailClient;
  readonly pubsubTopic: string;
  readonly anchors: AnchorStore;
}

export interface MailboxWatch {
  readonly historyId: string;
  readonly expiration: number;
}

export interface GmailClient {
  profileEmail(): Promise<string>;
  search(query: string, max: number): Promise<readonly RawEmail[]>;
  thread(threadId: string): Promise<readonly RawEmail[]>;
  archive(id: string): Promise<WriteOutcome>;
  draftReply(threadId: string, body: string): Promise<WriteOutcome>;
  unsubscribe(url: string): Promise<WriteOutcome>;
  messageMeta(id: string): Promise<RawEmail>;
  // INBOX messages added after startHistoryId; undefined when the anchor has
  // expired server-side (Gmail keeps roughly a week of history).
  historySince(
    startHistoryId: string,
  ): Promise<readonly HistoryAddedMessage[] | undefined>;
  watch(pubsubTopic: string): Promise<MailboxWatch>;
}
