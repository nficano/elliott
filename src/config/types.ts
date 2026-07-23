import type { GrantExplanation } from "../security/grants/types";

export interface WorkspaceMode {
  readonly dev: boolean;
}

export interface DeveloperFeedback {
  readonly inlineDeferredApprovals: boolean;
  readonly denialExplanation?: GrantExplanation;
  readonly reportUsageDeltaOnReload: boolean;
}
