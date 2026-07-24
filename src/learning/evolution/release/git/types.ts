import type { AuditLog } from "../../../../audit/log";
import type { PrincipalId } from "../../../../core/types";
import type { Proposal } from "../../../types";

export interface EvolutionGitProjectionAdapter {
  readonly publishDraft: (
    proposal: Proposal,
    branchName: string,
  ) => Promise<string>;
}

export interface EvolutionGitCliProjectionOptions {
  readonly repository: string;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly baseRef?: string;
  readonly projectionRoot?: string;
  readonly temporaryRoot?: string;
  readonly environment?:
    | Readonly<Record<string, string | undefined>>
    | undefined;
}

export interface EvolutionGitProcessOptions {
  readonly cwd?: string;
  readonly acceptedExitCodes?: readonly number[];
  readonly environment?:
    | Readonly<Record<string, string | undefined>>
    | undefined;
}

export interface EvolutionGitProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface EvolutionGitCommitInput {
  readonly checkout: string;
  readonly proposal: Proposal;
  readonly branchName: string;
  readonly projectionRoot: string;
  readonly environment?:
    | Readonly<Record<string, string | undefined>>
    | undefined;
}

export interface EvolutionGitProjectionInput {
  readonly proposal: Proposal;
  readonly principalId: PrincipalId;
  readonly repositoryRef: string;
  readonly records: AuditLog;
  readonly adapter: EvolutionGitProjectionAdapter;
}
