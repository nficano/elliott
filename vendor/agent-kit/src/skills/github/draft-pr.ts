import * as Effect from "effect/Effect";
import { applyAnchoredEdits, fencePaths } from "../../core/edits.js";
import { errorMessage, ToolError } from "../../core/errors.js";
import type { Github } from "../../integrations/types.js";
import type { Cfg } from "./schema.js";
import type { ProposalInput, ProposalOutput } from "./types.js";

const BRANCH_STAMP_RADIX = 36;

export function makeDraftPr(params: {
  readonly cfg: Cfg;
  readonly github: Github;
  readonly now: () => number;
}): (input: ProposalInput) => Promise<ProposalOutput> {
  return async (input) => {
    validateInput(input, params.cfg.allowed_prefixes);
    const files = await materializeFiles({
      input,
      github: params.github,
      baseBranch: params.cfg.base_branch,
    });
    const branch = `${params.cfg.branch_prefix}/${input.branchSuffix}-${
      params.now().toString(BRANCH_STAMP_RADIX)
    }`;
    const pullRequest = await openPullRequest({
      input,
      files,
      branch,
      baseBranch: params.cfg.base_branch,
      github: params.github,
    });
    return {
      url: pullRequest.url,
      ref: branch,
      note:
        "DRAFT pull request — nothing lands until a human marks it ready and merges.",
    };
  };
}

function validateInput(
  input: ProposalInput,
  allowedPrefixes: readonly string[],
): void {
  const editPaths = input.edits.map((edit) => edit.path);
  const createPaths = input.creates.map((create) => create.path);
  const offenders = fencePaths(
    [...editPaths, ...createPaths],
    allowedPrefixes,
  );
  if (offenders.length > 0) {
    throw new ToolError({
      message: `paths outside the allowed prefixes: ${offenders.join(", ")}`,
    });
  }
  const edited = new Set(editPaths);
  const collision = createPaths.find((path) => edited.has(path));
  if (collision) {
    throw new ToolError({
      message: `'${collision}' is both edited and created`,
    });
  }
  if (input.edits.length === 0 && input.creates.length === 0) {
    throw new ToolError({ message: "nothing to propose" });
  }
}

async function materializeFiles(params: {
  readonly input: ProposalInput;
  readonly github: Github;
  readonly baseBranch: string;
}): Promise<{ path: string; content: string; }[]> {
  const files: { path: string; content: string; }[] = [];
  for (const [path, edits] of groupEdits(params.input)) {
    const file = await readFile({
      github: params.github,
      path,
      baseBranch: params.baseBranch,
    });
    const applied = applyAnchoredEdits(file.content, edits);
    if (!applied.ok) throw editFailure(path, applied.failure);
    files.push({ path, content: applied.content });
  }
  for (const create of params.input.creates) {
    files.push({ path: create.path, content: create.content });
  }
  return files;
}

function groupEdits(
  input: ProposalInput,
): Map<string, { find: string; replace: string; }[]> {
  const byPath = new Map<string, { find: string; replace: string; }[]>();
  for (const edit of input.edits) {
    const group = byPath.get(edit.path) ?? [];
    group.push({ find: edit.find, replace: edit.replace });
    byPath.set(edit.path, group);
  }
  return byPath;
}

async function readFile(params: {
  readonly github: Github;
  readonly path: string;
  readonly baseBranch: string;
}): Promise<{ content: string; }> {
  return Effect.runPromise(
    params.github.getFile(params.path, params.baseBranch),
  ).catch((error) => {
    throw new ToolError({
      message: `cannot read '${params.path}' at ${params.baseBranch}: ${
        errorMessage(error)
      }`,
    });
  });
}

function editFailure(
  path: string,
  failure:
    | { readonly kind: "absent"; readonly index: number; }
    | {
      readonly kind: "ambiguous";
      readonly index: number;
      readonly count: number;
    },
): ToolError {
  const message = failure.kind === "absent"
    ? `anchor ${failure.index} not found in '${path}' — copy anchors verbatim from the current file; whole set aborted`
    : `anchor ${failure.index} matches ${failure.count}× in '${path}' — make it unique; whole set aborted`;
  return new ToolError({ message });
}

async function openPullRequest(params: {
  readonly input: ProposalInput;
  readonly files: readonly { path: string; content: string; }[];
  readonly branch: string;
  readonly baseBranch: string;
  readonly github: Github;
}): Promise<{ url: string; }> {
  return Effect.runPromise(
    params.github.openDraftPullRequest({
      base: params.baseBranch,
      branch: params.branch,
      title: params.input.title,
      body: params.input.body ?? "",
      files: params.files,
    }),
  ).catch((error) => {
    throw new ToolError({
      message: `draft PR failed: ${errorMessage(error)}`,
    });
  });
}
