import { describe, expect, it } from "bun:test";
import { ConfigurationActivationManager } from "../../src/config/activation/index";
import { digest, principalId } from "../../src/core/brands";
import { SkillCurator } from "../../src/learning/curator/index";
import {
  approveProposal,
  promoteProposal,
} from "../../src/learning/evaluation/index";
import type { LearnedSkill, Proposal } from "../../src/learning/types";

const proposal = (): Proposal =>
  Object.freeze({
    id: "proposal",
    directory: "/proposal",
    author: principalId("author"),
    target: { ref: "workspace/policy/default", digest: digest("target") },
    signals: [{
      id: "signal",
      rank: 1,
      source: "user",
      evidence: "correction",
      createdAt: new Date().toISOString(),
    }],
    artifacts: {
      rationale: "rationale",
      targetYaml: "target: policy",
      patch: "patch",
      evidenceYaml: "evidence: []",
      permissionDiffYaml: "permissions: []",
      evaluationPlanYaml: "stages: []",
      support: {},
    },
    status: "authored",
  });

const learnedSkill = (
  name: string,
  createdBy: LearnedSkill["createdBy"],
  pinned: boolean,
): LearnedSkill => ({
  name,
  createdBy,
  pinned,
  markdown: "skill",
  lifecycle: "active",
  lastUsedAt: new Date(0).toISOString(),
  hasExecutableOverlay: false,
});

describe("Phase 3 control plane", () => {
  it("activates one immutable candidate or leaves the old revision intact", async () => {
    const active = {
      id: "a",
      digest: digest("a"),
      touchedEpochs: [],
      policyDigests: [digest("policy-a")],
      createdAt: new Date().toISOString(),
    };
    let healthy = false;
    let commits = 0;
    let discards = 0;
    const manager = new ConfigurationActivationManager(active, {
      async evaluateSecurityDelta() {
        return {
          widenedCapabilities: [],
          narrowedCapabilities: [],
          classificationChanged: false,
        };
      },
      async startCandidate() {},
      async healthCheck() {
        return healthy;
      },
      async commit() {
        commits += 1;
      },
      async discard() {
        discards += 1;
      },
    });
    const candidate = {
      id: "b",
      digest: digest("b"),
      parentDigest: active.digest,
      touchedEpochs: ["workspace"],
      policyDigests: [digest("policy-b")],
      createdAt: new Date().toISOString(),
    };
    expect((await manager.activate(candidate)).type).toBe("rejected");
    expect(manager.active).toBe(active);
    expect(discards).toBe(1);
    healthy = true;
    expect((await manager.activate(candidate)).type).toBe("activated");
    expect(commits).toBe(1);
    expect(manager.active).toBe(candidate);
  });

  it("separates proposal author, approver, and promoter and detects staleness", async () => {
    const authored = proposal();
    const report = {
      proposalId: authored.id,
      results: [],
      passed: true,
    };
    expect(() => approveProposal(authored, authored.author, report)).toThrow(
      "cannot approve",
    );
    const approved = approveProposal(authored, principalId("approver"), report);
    await expect(promoteProposal(
      approved,
      approved.author,
      {
        async activeDigest() {
          return digest("target");
        },
        async promote() {},
      },
    )).rejects.toThrow("cannot promote");
    const stale = await promoteProposal(
      approved,
      principalId("promoter"),
      {
        async activeDigest() {
          return digest("changed");
        },
        async promote() {},
      },
    );
    expect(stale.status).toBe("stale");
  });

  it("archives only recoverable, agent-created, unpinned skills", () => {
    const actions = new SkillCurator().maintain([
      learnedSkill("agent", "agent", false),
      learnedSkill("pinned", "agent", true),
      learnedSkill("operator", "operator", false),
    ]);
    expect(actions).toEqual([{
      skill: "agent",
      type: "archive",
      recoverable: true,
    }]);
  });
});
