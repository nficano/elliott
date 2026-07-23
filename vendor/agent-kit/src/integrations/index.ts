/**
 * Optional opt-in integration clients (§21/§25; CAPABILITIES-TDD §9.4) —
 * generic and reusable, NO domain-specific providers. `http.ts` is the shared core
 * every client builds on; `github.ts` is the reference client shape. The
 * `github` skill that builds on this client lives in `skills/github`.
 */
export { makeGithub } from "./github.js";
export { makeGoogleAuth } from "./google-auth.js";
export { IntegrationError, makeHttp } from "./http.js";
export type {
  CreatedIssue,
  DraftPullRequest,
  Github,
  GithubFile,
  GithubParams,
} from "./types.js";
export type {
  GoogleAuth,
  MakeGoogleAuthParams,
  ServiceAccountJson,
} from "./types.js";
export type { HttpClient, HttpRequest, MakeHttpOptions } from "./types.js";
