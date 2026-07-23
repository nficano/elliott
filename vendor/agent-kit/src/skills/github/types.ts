import type { Github } from "../../integrations/types.js";
import type { GithubConfig } from "./schema.js";

export type Cfg = typeof GithubConfig.Type;

export interface ProposalInput {
  readonly title: string;
  readonly body?: string | undefined;
  readonly branchSuffix: string;
  readonly edits: ReadonlyArray<{
    readonly path: string;
    readonly find: string;
    readonly replace: string;
  }>;
  readonly creates: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
}

export type ProposalOutput = {
  readonly url: string;
  readonly ref: string;
  readonly note: string;
};

export interface GithubOverrides {
  /** Test seam: swap the GitHub client / the clock. */
  readonly github?: (cfg: Cfg, token: string) => Github;
  readonly now?: () => number;
}
