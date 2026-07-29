export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface GoogleTokenSource {
  token(): Promise<string>;
}

export type GoogleJson = Readonly<Record<string, unknown>>;

export interface GoogleRequestSpec {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly body?: GoogleJson;
}

export interface GoogleClient {
  request(spec: GoogleRequestSpec): Promise<GoogleJson>;
}

export interface GoogleClientOptions {
  readonly fetcher?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}
