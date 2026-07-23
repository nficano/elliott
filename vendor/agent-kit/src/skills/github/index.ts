/**
 * skills/github (§21; CAPABILITIES-TDD §9.4) — the github skill. Its `draft_pr`
 * write-tool stages a finding as a reviewable DRAFT pull request, building on
 * the `integrations/github` client; a human reviews and merges — the skill
 * never merges or deploys. Disabled by default (§5).
 */
export { githubPack, githubSkill } from "./github.js";
export type {
  Cfg,
  GithubOverrides,
  ProposalInput,
  ProposalOutput,
} from "./types.js";
