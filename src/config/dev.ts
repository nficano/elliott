import type { GrantExplanation } from "../security/grants/types";
import type { DeveloperFeedback, WorkspaceMode } from "./types";

export const developerFeedback = (
  mode: WorkspaceMode,
  denial?: GrantExplanation,
): DeveloperFeedback => {
  const common = {
    inlineDeferredApprovals: mode.dev,
    reportUsageDeltaOnReload: mode.dev,
  };
  return denial === undefined
    ? common
    : { ...common, denialExplanation: denial };
};
