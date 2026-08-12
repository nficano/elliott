import { describe, expect, it } from "bun:test";
import { developerFeedback } from "../../src/config/dev";
import { resolveGrantSet } from "../../src/security/grants/resolution";
import { makeGrantIssue } from "../helpers";

describe("M2 development mode", () => {
  it("changes feedback without changing grant resolution", () => {
    const issue = makeGrantIssue();
    const before = resolveGrantSet(issue);
    const normal = developerFeedback({ dev: false });
    const development = developerFeedback({ dev: true }, {
      capability: "network.connect",
      removedBy: "workspace",
    });
    const after = resolveGrantSet(issue);
    expect(after).toEqual(before);
    expect(normal.inlineDeferredApprovals).toBe(false);
    expect(development.inlineDeferredApprovals).toBe(true);
    expect(development.reportUsageDeltaOnReload).toBe(true);
    expect(development.denialExplanation?.removedBy).toBe("workspace");
  });
});
