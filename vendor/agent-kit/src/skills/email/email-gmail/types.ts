// Gmail message/thread shapes now come from `@googleapis/gmail` (gmail_v1.Schema$*);
// only the OAuth creds live here.
export interface GmailCreds {
  readonly client_id: string;
  readonly client_secret: string;
  readonly refresh_token: string;
}
