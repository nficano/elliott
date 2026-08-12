export type EvolutionCliOperation =
  | "evolution.inspect"
  | "evolution.dataset.build"
  | "evolution.run"
  | "evolution.status"
  | "evolution.pause"
  | "evolution.resume"
  | "evolution.cancel"
  | "evolution.compare"
  | "evolution.propose"
  | "proposal.review"
  | "proposal.approve"
  | "proposal.reject"
  | "release.promote"
  | "release.rollback";

export interface EvolutionCliRequest {
  readonly operation: EvolutionCliOperation;
  readonly arguments: readonly string[];
}

export interface EvolutionCliBackend {
  readonly execute: (request: EvolutionCliRequest) => Promise<unknown>;
}

export interface EvolutionControlAuthority {
  readonly principalId: string;
  readonly snapshotId: string;
  readonly authorize: (
    capability: string,
    resources: readonly string[],
  ) => Promise<boolean>;
}

export interface EvolutionControlAuthorityResolver {
  readonly resolve: (request: Request) => Promise<EvolutionControlAuthority>;
}

export interface EvolutionControlPlaneExecutor {
  readonly execute: (
    authority: EvolutionControlAuthority,
    request: EvolutionCliRequest,
  ) => Promise<unknown>;
}

export interface EvolutionControlPlaneBinding {
  readonly handle: (request: Request) => Promise<Response>;
}
