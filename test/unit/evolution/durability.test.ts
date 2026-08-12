import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, MemoryCommitAdapter } from "../../../src/audit/index";
import { digest, principalId, snapshotId } from "../../../src/core/brands";
import { hashBytes } from "../../../src/core/digest";
import { FileSnapshotStore } from "../../../src/core/snapshot/snapshot";
import { approveProposal } from "../../../src/learning/evaluation/index";
import {
  EvolutionCandidate,
  EvolutionPromptSourceRevision,
  EvolutionToolDescriptionRevision,
} from "../../../src/learning/evolution/model/index";
import {
  makeEvolutionCandidateStore,
} from "../../../src/learning/evolution/store/candidate";
import { makeEvolutionRunStore } from "../../../src/learning/evolution/store/run";
import {
  FileEvolutionArtifactCatalog,
} from "../../../src/learning/evolution/targets/catalog";
import { FileProposalStore } from "../../../src/learning/proposals/index";
import type { Proposal, ProposalArtifacts } from "../../../src/learning/types";
import { makeCandidate, makeRun } from "./helpers";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true })),
  );
});

const temporary = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

const proposalArtifacts = (): ProposalArtifacts => ({
  rationale: "rationale",
  targetYaml: "target: review",
  patch: "-old\n+new",
  evidenceYaml: "passed: true",
  permissionDiffYaml: "widened: []",
  evaluationPlanYaml: "seed: 1",
  candidateYaml: "id: candidate",
  lineageYaml: "parent: null",
  datasetYaml: "digest: dataset",
  comparisonYaml: "passed: true",
  footprintsYaml: "[]",
  benchmarksYaml: "[]",
  rollbackYaml: "previous: baseline",
  support: { "case.txt": "evidence" },
});

describe("evolution durability", () => {
  it("reloads schema-decoded runs and immutable Snapshots", async () => {
    const root = await temporary("elliott-evolution-");
    const run = makeRun();
    await Effect.runPromise(makeEvolutionRunStore(root).save(run));
    const reloaded = await Effect.runPromise(
      makeEvolutionRunStore(root).get(run.id),
    );
    expect(reloaded).toEqual(run);

    const snapshotRoot = path.join(root, "snapshots");
    const snapshots = new FileSnapshotStore(snapshotRoot);
    const created = snapshots.create({
      configurationDigest: digest("sha256:configuration"),
      registryDigest: digest("sha256:registry"),
      components: [],
      configuration: { target: "candidate" },
    });
    expect(new FileSnapshotStore(snapshotRoot).get(created.id)).toEqual(
      created,
    );
  });

  it("persists Proposal state and authority across restart", async () => {
    const root = await temporary("elliott-proposals-");
    const records = new AuditLog(new MemoryCommitAdapter());
    const store = await FileProposalStore.open({ root, records });
    const authored = await store.author({
      author: principalId("author"),
      target: {
        ref: "workspace/skill/review",
        digest: digest("sha256:baseline"),
      },
      signals: [{
        id: "signal",
        rank: 1,
        source: "user",
        evidence: "correction",
        createdAt: new Date(0).toISOString(),
      }],
      artifacts: proposalArtifacts(),
      evolution: {
        runId: "evr_12345678",
        targetClass: "skill",
        riskClass: "C1",
        candidateDigest: "sha256:candidate",
        baselineSnapshotId: "snapshot:baseline",
        candidateSnapshotId: "snapshot:candidate",
        evaluationReportId: "eve_12345678",
        datasetDigest: "sha256:dataset",
      },
    });
    const approved = approveProposal(
      authored,
      principalId("approver"),
      { proposalId: authored.id, results: [], passed: true },
    );
    await store.update(approved);
    const reloaded = await FileProposalStore.open({ root, records });
    expect(reloaded.get(authored.id)?.status).toBe("approved");
    expect(reloaded.get(authored.id)?.approver).toBe("approver");
    expect(reloaded.get(authored.id)?.evolution?.runId).toBe("evr_12345678");
    expect(reloaded.get(authored.id)?.artifacts.rollbackYaml)
      .toBe("previous: baseline");
    await expect(store.update(
      Object.freeze({
        ...approved,
        status: "rejected",
        target: {
          ...approved.target,
          digest: digest("sha256:substituted"),
        },
      }) satisfies Proposal,
    )).rejects.toThrow(
      "identity and evidence are immutable",
    );
  });

  it("persists both required C3 reviewers before approval", async () => {
    const root = await temporary("elliott-c3-reviews-");
    const records = new AuditLog(new MemoryCommitAdapter());
    const store = await FileProposalStore.open({ root, records });
    const authored = await store.author({
      author: principalId("author"),
      target: {
        ref: "core/code/scheduler",
        digest: digest("sha256:baseline"),
      },
      signals: [],
      artifacts: proposalArtifacts(),
      evolution: {
        runId: "evr_12345678",
        targetClass: "code",
        riskClass: "C3",
        candidateDigest: "sha256:candidate",
        baselineSnapshotId: "snapshot:baseline",
        candidateSnapshotId: "snapshot:candidate",
        evaluationReportId: "eve_12345678",
        datasetDigest: "sha256:dataset",
      },
    });
    const firstReviewer = principalId("reviewer-one");
    const partial = Object.freeze({
      ...authored,
      status: "awaiting-review",
      approver: firstReviewer,
      approvers: Object.freeze([firstReviewer]),
    }) satisfies Proposal;
    await store.update(partial);
    await expect(store.update(
      Object.freeze({
        ...partial,
        status: "approved",
      }) satisfies Proposal,
    )).rejects.toThrow(
      "every required review",
    );
    const secondReviewer = principalId("reviewer-two");
    await store.update(
      Object.freeze({
        ...partial,
        status: "approved",
        approver: secondReviewer,
        approvers: Object.freeze([firstReviewer, secondReviewer]),
      }) satisfies Proposal,
    );
    const reloaded = await FileProposalStore.open({ root, records });
    expect(reloaded.get(authored.id)?.status).toBe("approved");
    expect(reloaded.get(authored.id)?.approvers).toEqual([
      "reviewer-one",
      "reviewer-two",
    ]);
  });

  it("binds durable tool and prompt revisions to immutable Snapshots", async () => {
    const root = await temporary("elliott-artifacts-");
    const snapshot = snapshotId("snapshot:candidate");
    const catalog = new FileEvolutionArtifactCatalog(root);
    catalog.registerToolRevision(EvolutionToolDescriptionRevision.make({
      catalogDigest: "sha256:tools",
      snapshotId: snapshot,
      descriptions: { search: { description: "Search." } },
      schemaDigests: { search: "sha256:schema" },
      createdAt: new Date(0).toISOString(),
    }));
    catalog.registerPromptRevision(EvolutionPromptSourceRevision.make({
      sourceId: "interaction-profile:default",
      sourceDigest: "sha256:prompt",
      snapshotId: snapshot,
      purpose: "interaction-profile",
      trust: "authenticated",
      content: "Be concise.",
      createdAt: new Date(0).toISOString(),
    }));
    const reloaded = new FileEvolutionArtifactCatalog(root);
    expect(reloaded.toolsForSnapshot(snapshot).catalogDigest)
      .toBe("sha256:tools");
    expect(
      reloaded.promptForSnapshot(
        snapshot,
        "interaction-profile:default",
      ).sourceDigest,
    ).toBe("sha256:prompt");
  });

  it("refuses to overwrite a content-addressed candidate", async () => {
    const root = await temporary("elliott-candidates-");
    const store = makeEvolutionCandidateStore(root);
    const candidate = makeCandidate();
    await Effect.runPromise(store.save(candidate));
    const changed = EvolutionCandidate.make({
      ...candidate,
      candidateDigest: hashBytes("changed"),
      materializedContent: "changed",
      patch: "+changed",
    });
    await expect(Effect.runPromise(store.save(changed)))
      .rejects.toHaveProperty("_tag", "EvolutionPersistenceError");
    expect((await Effect.runPromise(store.get(candidate.id))).candidateDigest)
      .toBe(candidate.candidateDigest);
  });
});
