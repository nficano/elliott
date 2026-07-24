import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Proposal } from "../../types";
import type {
  EvolutionGitCliProjectionOptions,
  EvolutionGitCommitInput,
  EvolutionGitProcessOptions,
  EvolutionGitProcessResult,
  EvolutionGitProjectionAdapter,
} from "./git/types";

const DEFAULT_PROJECTION_ROOT = ".elliott/evolution-proposals";
const SAFE_PROPOSAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_BRANCH = /^elliott\/evolution\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const runGit = async (
  arguments_: readonly string[],
  options: EvolutionGitProcessOptions = {},
): Promise<EvolutionGitProcessResult> => {
  const child = Bun.spawn(["git", ...arguments_], {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    env: {
      ...options.environment,
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const accepted = options.acceptedExitCodes ?? [0];
  if (!accepted.includes(exitCode)) {
    const detail = stderr.trim() || stdout.trim() || "no diagnostic output";
    throw new Error(`git command failed with exit code ${exitCode}: ${detail}`);
  }
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
};

const assertRelativeProjectionRoot = (value: string): void => {
  const segments = new Set(value.split(/[\\/]/u));
  if (
    value.length === 0
    || path.isAbsolute(value)
    || segments.has("..")
    || segments.has("")
  ) {
    throw new TypeError(
      "Git projection root must be a contained relative path",
    );
  }
};

const assertSafeProjection = (
  proposal: Proposal,
  branchName: string,
  projectionRoot: string,
): void => {
  if (!SAFE_PROPOSAL_ID.test(proposal.id)) {
    throw new TypeError("Proposal id is not safe for Git projection");
  }
  if (
    !SAFE_BRANCH.test(branchName)
    || branchName !== `elliott/evolution/${proposal.id}`
  ) {
    throw new TypeError("Git projection branch does not match the Proposal");
  }
  assertRelativeProjectionRoot(projectionRoot);
};

const copyProposalBundle = async (
  source: string,
  destination: string,
): Promise<void> => {
  const sourceMetadata = await lstat(source);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new TypeError("Proposal artifact root must be a real directory");
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  const sorted = entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const entry of sorted) {
    if (entry.isSymbolicLink()) {
      throw new TypeError("Proposal Git projection rejects symbolic links");
    }
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyProposalBundle(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    } else {
      throw new TypeError("Proposal Git projection rejects special files");
    }
  }
};

const assertBranchAbsent = async (
  checkout: string,
  branchName: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<void> => {
  const result = await runGit(
    [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branchName}`,
    ],
    { cwd: checkout, acceptedExitCodes: [0, 1], environment },
  );
  if (result.exitCode === 0) {
    throw new Error(`Git projection branch already exists: ${branchName}`);
  }
};

const configureCheckout = async (
  checkout: string,
  options: EvolutionGitCliProjectionOptions,
): Promise<void> => {
  const command = (arguments_: readonly string[]) =>
    runGit(arguments_, { cwd: checkout, environment: options.environment });
  await command(["config", "user.name", options.committerName]);
  await command(["config", "user.email", options.committerEmail]);
  await command(["config", "commit.gpgSign", "false"]);
  await command(["config", "push.gpgSign", "false"]);
};

const commitAndPush = async (
  input: EvolutionGitCommitInput,
): Promise<string> => {
  const command = (arguments_: readonly string[]) =>
    runGit(arguments_, {
      cwd: input.checkout,
      environment: input.environment,
    });
  await command([
    "add",
    "--",
    path.join(input.projectionRoot, input.proposal.id),
  ]);
  await command([
    "commit",
    "-m",
    `Propose Elliott evolution ${input.proposal.id}`,
  ]);
  const remoteRef = `refs/heads/${input.branchName}`;
  await command(["push", "origin", `${remoteRef}:${remoteRef}`]);
  return remoteRef;
};

const publishFromTemporaryClone = async (
  proposal: Proposal,
  branchName: string,
  options: EvolutionGitCliProjectionOptions,
): Promise<string> => {
  const projectionRoot = options.projectionRoot ?? DEFAULT_PROJECTION_ROOT;
  assertSafeProjection(proposal, branchName, projectionRoot);
  const temporaryParent = options.temporaryRoot ?? tmpdir();
  await mkdir(temporaryParent, { recursive: true });
  const temporary = await mkdtemp(
    path.join(temporaryParent, "elliott-git-projection-"),
  );
  const checkout = path.join(temporary, "checkout");
  try {
    await runGit([
      "clone",
      "--no-hardlinks",
      "--",
      options.repository,
      checkout,
    ], { environment: options.environment });
    if (options.baseRef !== undefined) {
      await runGit(["switch", "--detach", options.baseRef], {
        cwd: checkout,
        environment: options.environment,
      });
    }
    await assertBranchAbsent(checkout, branchName, options.environment);
    await runGit(["switch", "-c", branchName], {
      cwd: checkout,
      environment: options.environment,
    });
    await configureCheckout(checkout, options);
    const destination = path.join(checkout, projectionRoot, proposal.id);
    await copyProposalBundle(path.resolve(proposal.directory), destination);
    return await commitAndPush({
      checkout,
      proposal,
      branchName,
      projectionRoot,
      environment: options.environment,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

export const makeGitCliProjectionAdapter = (
  options: EvolutionGitCliProjectionOptions,
): EvolutionGitProjectionAdapter => ({
  publishDraft: (proposal, branchName) =>
    publishFromTemporaryClone(proposal, branchName, options),
});
