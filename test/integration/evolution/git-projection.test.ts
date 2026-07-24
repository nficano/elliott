import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLog, MemoryCommitAdapter } from "../../../src/audit/index";
import type { AuditCommitAdapter } from "../../../src/audit/types";
import { digest, principalId } from "../../../src/core/brands";
import {
  makeGitCliProjectionAdapter,
  projectEvolutionProposalToGit,
} from "../../../src/learning/evolution/index";
import type { Proposal } from "../../../src/learning/types";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(pending.map((root) => rm(root, { recursive: true })));
});

const runGit = async (
  arguments_: readonly string[],
  cwd?: string,
  acceptedExitCodes: readonly number[] = [0],
): Promise<{ readonly exitCode: number; readonly stdout: string; }> => {
  const child = Bun.spawn(["git", ...arguments_], {
    ...(cwd !== undefined && { cwd }),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error(stderr.trim() || `git exited with ${exitCode}`);
  }
  return { exitCode, stdout: stdout.trim() };
};

const makeRemote = async (root: string): Promise<string> => {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  await runGit(["init", "--bare", "--initial-branch=main", remote]);
  await runGit(["init", "--initial-branch=main", seed]);
  await runGit(["config", "user.name", "Fixture"], seed);
  await runGit(["config", "user.email", "fixture@example.invalid"], seed);
  await runGit(["config", "commit.gpgSign", "false"], seed);
  await runGit(["config", "push.gpgSign", "false"], seed);
  await writeFile(path.join(seed, "README.md"), "# Fixture\n");
  await runGit(["add", "--", "README.md"], seed);
  await runGit(["commit", "-m", "Initial fixture"], seed);
  await runGit(["remote", "add", "origin", remote], seed);
  await runGit(["push", "--set-upstream", "origin", "main"], seed);
  return remote;
};

const makeProposal = async (root: string): Promise<Proposal> => {
  const directory = path.join(root, "proposal");
  await mkdir(path.join(directory, "support"), { recursive: true });
  await writeFile(path.join(directory, "proposal.yaml"), "status: authored\n");
  await writeFile(path.join(directory, "PROPOSAL.md"), "# Review me\n");
  await writeFile(path.join(directory, "patch.diff"), "-old\n+new\n");
  await writeFile(
    path.join(directory, "support", "case-summary.jsonl"),
    "{\"passed\":true}\n",
  );
  return {
    id: "prp_git_fixture",
    directory,
    author: principalId("EvolutionProposalAuthor"),
    target: {
      ref: "workspace/skill/review",
      digest: digest("sha256:baseline"),
    },
    signals: [],
    artifacts: {
      rationale: "# Review me\n",
      targetYaml: "target: review\n",
      patch: "-old\n+new\n",
      evidenceYaml: "passed: true\n",
      permissionDiffYaml: "widened: []\n",
      evaluationPlanYaml: "seed: 1\n",
      support: { "case-summary.jsonl": "{\"passed\":true}\n" },
    },
    status: "authored",
  };
};

class RejectingCommitAdapter implements AuditCommitAdapter {
  commit(): Promise<void> {
    return Promise.reject(new Error("durability unavailable"));
  }
}

describe("optional evolution Git projection", () => {
  it("publishes only the Proposal bundle to a new branch in a bare remote", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-git-proof-"));
    roots.push(root);
    const remote = await makeRemote(root);
    const proposal = await makeProposal(root);
    const commits = new MemoryCommitAdapter();
    const records = new AuditLog(commits);
    const adapter = makeGitCliProjectionAdapter({
      repository: remote,
      committerName: "Elliott Proposal Projector",
      committerEmail: "elliott@example.invalid",
      temporaryRoot: path.join(root, "temporary"),
    });

    const remoteRef = await Effect.runPromise(projectEvolutionProposalToGit({
      proposal,
      principalId: principalId("EvolutionGitProjector"),
      repositoryRef: "fixture/local-bare",
      records,
      adapter,
    }));

    expect(remoteRef).toBe("refs/heads/elliott/evolution/prp_git_fixture");
    const projected = await runGit([
      "--git-dir",
      remote,
      "show",
      `${remoteRef}:.elliott/evolution-proposals/prp_git_fixture/PROPOSAL.md`,
    ]);
    expect(projected.stdout).toBe("# Review me");
    const publicationIntent = Object.values(records.snapshot().shards)
      .flat()
      .find((record) => record.type === "evolution.git.publication-intent");
    expect(publicationIntent).toBeDefined();
    expect(commits.has(publicationIntent?.id ?? "")).toBe(true);
  });

  it("does not push when the effect-gating publication intent cannot commit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-git-gate-"));
    roots.push(root);
    const remote = await makeRemote(root);
    const proposal = await makeProposal(root);
    const records = new AuditLog(new RejectingCommitAdapter());
    const adapter = makeGitCliProjectionAdapter({
      repository: remote,
      committerName: "Elliott Proposal Projector",
      committerEmail: "elliott@example.invalid",
      temporaryRoot: path.join(root, "temporary"),
    });

    await expect(
      Effect.runPromise(projectEvolutionProposalToGit({
        proposal,
        principalId: principalId("EvolutionGitProjector"),
        repositoryRef: "fixture/local-bare",
        records,
        adapter,
      })),
    ).rejects.toMatchObject({
      _tag: "EvolutionPromotionError",
      stage: "git-publication-intent",
    });
    const branch = await runGit(
      [
        "--git-dir",
        remote,
        "show-ref",
        "--verify",
        "--quiet",
        "refs/heads/elliott/evolution/prp_git_fixture",
      ],
      undefined,
      [0, 1],
    );
    expect(branch.exitCode).toBe(1);
  });
});
