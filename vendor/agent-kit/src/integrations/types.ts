import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { IntegrationError } from "./http.js";

export interface GithubParams {
  /** `owner/repo`. */
  readonly repo: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

export interface GithubFile {
  readonly path: string;
  readonly content: string;
  readonly sha: string;
}

export interface CreatedIssue {
  readonly number: number;
  readonly url: string;
}

export interface DraftPullRequest {
  readonly number: number;
  readonly url: string;
  readonly branch: string;
}

export interface Github {
  getFile(
    path: string,
    ref?: string,
  ): Effect.Effect<GithubFile, IntegrationError>;
  createIssue(
    title: string,
    body: string,
  ): Effect.Effect<CreatedIssue, IntegrationError>;
  commentIssue(
    issue: number,
    body: string,
  ): Effect.Effect<void, IntegrationError>;
  /**
   * Stage files on a new branch off `base` and open a DRAFT pull request —
   * the git-data chain (base ref → tree → commit → ref → PR). Never merges.
   */
  openDraftPullRequest(input: {
    readonly base: string;
    readonly branch: string;
    readonly title: string;
    readonly body: string;
    readonly files: readonly { path: string; content: string; }[];
  }): Effect.Effect<DraftPullRequest, IntegrationError>;
}

export interface GithubRuntime {
  readonly repo: string;
  readonly http: HttpClient;
  readonly headers: Record<string, string>;
}

export interface HttpRequest {
  readonly url: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface HttpClient {
  fetchJson<T>(
    req: HttpRequest,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, IntegrationError>;
  fetchText(
    req: HttpRequest,
  ): Effect.Effect<{ status: number; text: string; }, IntegrationError>;
}

export interface MakeHttpOptions {
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable unit-interval random source for deterministic retry tests. */
  readonly random?: () => number;
}

export interface RequestRuntime {
  readonly service: string;
  readonly doFetch: typeof fetch;
  readonly random: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ServiceAccountJson {
  readonly client_email: string;
  readonly private_key: string;
  readonly project_id?: string;
}

export interface GoogleAuth {
  readonly clientEmail: string;
  readonly projectId?: string;
  token(): Effect.Effect<string, IntegrationError>;
}

export interface MakeGoogleAuthParams {
  readonly sa: ServiceAccountJson;
  /** e.g. "https://www.googleapis.com/auth/cloud-platform". */
  readonly scope: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}
