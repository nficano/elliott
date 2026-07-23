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

export interface GmailClient {
  profileEmail(): Promise<string>;
  search(query: string, max: number): Promise<readonly RawEmail[]>;
  thread(threadId: string): Promise<readonly RawEmail[]>;
  archive(id: string): Promise<WriteOutcome>;
  draftReply(threadId: string, body: string): Promise<WriteOutcome>;
  unsubscribe(url: string): Promise<WriteOutcome>;
}
