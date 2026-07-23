import { define } from "../../core/agent/index.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { makeGithub } from "../../integrations/github.js";
import { makeDraftPr } from "./draft-pr.js";
import { type Cfg, DraftPrInput, GithubConfig } from "./schema.js";
import type { GithubOverrides } from "./types.js";

/**
 * `github` skill — its `draft_pr` tool stages a finding as a DRAFT pull
 * request a human reviews and merges; the skill never merges, never deploys.
 * Guardrails, all fail-closed: paths fenced to `allowed_prefixes` (empty
 * allowlist = everything fenced out), anchored edits abort the whole set on an
 * absent/ambiguous anchor, edit/create path collisions rejected, branch names
 * carry a mint-time stamp so re-proposing never collides. Trust `write`: the
 * tool registers behind the approval gate (§16). Builds on the `integrations/
 * github` client. Disabled by default (§5).
 */

const manifest: Manifest<Cfg> = {
  id: "github",
  kind: "skill",
  version: "0.1.0",
  configSchema: GithubConfig,
  bundle: "ops",
  trust: "write",
  defaultTier: "standard",
  capabilities: ["writes:proposal"],
  contracts: { tools: ["draft_pr"] },
  secrets: [{
    name: "token",
    description: "GitHub token with contents+pulls scope",
  }],
};

export function githubSkill(
  overrides: GithubOverrides = {},
): Registrable<Cfg> {
  return {
    manifest,
    async activate(ctx) {
      const cfg = ctx.config;
      const gh = (overrides.github
        ?? ((c, token) => makeGithub({ repo: c.repo, token })))(
          cfg,
          ctx.secrets.token!,
        );
      const now = overrides.now ?? (() => Date.now());
      const propose = makeDraftPr({ cfg, github: gh, now });
      const tool = define({
        name: "draft_pr",
        description:
          "Stage a reviewable change as a DRAFT pull request: anchored find/replace edits to "
          + "existing files and/or new files, fenced to the configured path allowlist. Copy anchors "
          + "verbatim from the current file first. Never merges; a human reviews.",
        schema: DraftPrInput,
        meta: {
          componentId: "github",
          bundle: "ops",
          core: false,
          write: true,
        },
        run: async (args) => JSON.stringify(await propose(args)),
      });

      return { writeTools: [tool] };
    },
  };
}

export function githubPack(overrides: GithubOverrides = {}): Registrable[] {
  return [githubSkill(overrides)];
}
