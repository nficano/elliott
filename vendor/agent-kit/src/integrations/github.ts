import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IntegrationError, makeHttp } from "./http.js";
import type {
  CreatedIssue,
  DraftPullRequest,
  Github,
  GithubFile,
  GithubParams,
  GithubRuntime,
} from "./types.js";

/**
 * Minimal GitHub client (opt-in, §25 keep list; CAPABILITIES-TDD §9.4) — the
 * reference integration client: `make<Name>` factory, typed methods returning
 * an Effect, result-slicing (only the fields tools act on), explicit and few
 * writes. Backs the `github` skill's `draft_pr` tool.
 */

const API = "https://api.github.com";

// Response slices — only the fields the client acts on (§7.2 result-slicing).
const ShaObject = Schema.Struct({
  object: Schema.Struct({ sha: Schema.String }),
});
const Contents = Schema.Struct({
  content: Schema.optional(Schema.String),
  encoding: Schema.optional(Schema.String),
  sha: Schema.optional(Schema.String),
});
const Sha = Schema.Struct({ sha: Schema.String });
const IssueSlice = Schema.Struct({
  number: Schema.Number,
  html_url: Schema.String,
});

export function makeGithub(params: GithubParams): Github {
  const runtime: GithubRuntime = {
    repo: params.repo,
    http: makeHttp(
      "github",
      params.fetchImpl ? { fetchImpl: params.fetchImpl } : {},
    ),
    headers: {
      authorization: `Bearer ${params.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
  };

  return {
    getFile: (path, ref) => getFile(runtime, path, ref),
    createIssue: (title, body) => createIssue(runtime, title, body),
    commentIssue: (issue, body) => commentIssue(runtime, issue, body),
    openDraftPullRequest: (input) => openDraftPullRequest(runtime, input),
  };
}

function get<T>(
  runtime: GithubRuntime,
  path: string,
  schema: Schema.Decoder<T>,
): Effect.Effect<T, IntegrationError> {
  return runtime.http.fetchJson({
    url: `${API}${path}`,
    headers: runtime.headers,
  }, schema);
}

function post<T>(
  runtime: GithubRuntime,
  path: string,
  req: { readonly body: unknown; readonly schema: Schema.Decoder<T>; },
): Effect.Effect<T, IntegrationError> {
  return runtime.http.fetchJson({
    url: `${API}${path}`,
    method: "POST",
    headers: runtime.headers,
    body: JSON.stringify(req.body),
  }, req.schema);
}

function getFile(
  runtime: GithubRuntime,
  path: string,
  ref?: string,
): Effect.Effect<GithubFile, IntegrationError> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return get(
    runtime,
    `/repos/${runtime.repo}/contents/${encodePath(path)}${query}`,
    Contents,
  ).pipe(Effect.flatMap((json) => decodeFile(path, json)));
}

function decodeFile(
  path: string,
  json: typeof Contents.Type,
): Effect.Effect<GithubFile, IntegrationError> {
  if (typeof json.content !== "string" || json.encoding !== "base64") {
    return Effect.fail(
      new IntegrationError({
        tag: "github.api",
        message: `unexpected contents payload for '${path}'`,
      }),
    );
  }
  return Effect.succeed({
    path,
    content: Buffer.from(json.content, "base64").toString("utf8"),
    sha: json.sha ?? "",
  });
}

function createIssue(
  runtime: GithubRuntime,
  title: string,
  body: string,
): Effect.Effect<CreatedIssue, IntegrationError> {
  return post(runtime, `/repos/${runtime.repo}/issues`, {
    body: { title, body },
    schema: IssueSlice,
  }).pipe(Effect.map((json) => ({ number: json.number, url: json.html_url })));
}

function commentIssue(
  runtime: GithubRuntime,
  issue: number,
  body: string,
): Effect.Effect<void, IntegrationError> {
  return post(runtime, `/repos/${runtime.repo}/issues/${issue}/comments`, {
    body: { body },
    schema: Schema.Unknown,
  }).pipe(Effect.map(() => {}));
}

function openDraftPullRequest(
  runtime: GithubRuntime,
  input: Parameters<Github["openDraftPullRequest"]>[0],
): Effect.Effect<DraftPullRequest, IntegrationError> {
  // base ref → base commit → tree(with files) → commit → new ref → draft PR
  return get(
    runtime,
    `/repos/${runtime.repo}/git/ref/heads/${input.base}`,
    ShaObject,
  ).pipe(
    Effect.flatMap((baseRef) => createTree(runtime, input, baseRef.object.sha)),
    Effect.flatMap(({ baseSha, treeSha }) =>
      createCommit({ runtime, title: input.title, baseSha, treeSha })
    ),
    Effect.flatMap((commit) => createRef(runtime, input.branch, commit.sha)),
    Effect.flatMap(() => createDraft(runtime, input)),
    Effect.map((pullRequest) => ({
      number: pullRequest.number,
      url: pullRequest.html_url,
      branch: input.branch,
    })),
  );
}

function createTree(
  runtime: GithubRuntime,
  input: Parameters<Github["openDraftPullRequest"]>[0],
  baseSha: string,
): Effect.Effect<{ baseSha: string; treeSha: string; }, IntegrationError> {
  return post(runtime, `/repos/${runtime.repo}/git/trees`, {
    body: {
      base_tree: baseSha,
      tree: input.files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content,
      })),
    },
    schema: Sha,
  }).pipe(Effect.map((tree) => ({ baseSha, treeSha: tree.sha })));
}

function createCommit(
  params: {
    readonly runtime: GithubRuntime;
    readonly title: string;
    readonly baseSha: string;
    readonly treeSha: string;
  },
): Effect.Effect<{ sha: string; }, IntegrationError> {
  return post(params.runtime, `/repos/${params.runtime.repo}/git/commits`, {
    body: {
      message: params.title,
      tree: params.treeSha,
      parents: [params.baseSha],
    },
    schema: Sha,
  });
}

function createRef(
  runtime: GithubRuntime,
  branch: string,
  sha: string,
): Effect.Effect<unknown, IntegrationError> {
  return post(runtime, `/repos/${runtime.repo}/git/refs`, {
    body: { ref: `refs/heads/${branch}`, sha },
    schema: Schema.Unknown,
  });
}

function createDraft(
  runtime: GithubRuntime,
  input: Parameters<Github["openDraftPullRequest"]>[0],
): Effect.Effect<{ number: number; html_url: string; }, IntegrationError> {
  return post(runtime, `/repos/${runtime.repo}/pulls`, {
    body: {
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.base,
      draft: true,
    },
    schema: IssueSlice,
  });
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
