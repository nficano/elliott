import type { Epoch, EpochVector } from "../types";

export type EpochScope =
  | "organization"
  | "workspace"
  | "agent"
  | "session"
  | "principal";

export type EpochBumpReason =
  | "policy-change"
  | "revocation"
  | "config-activation"
  | "catalog-update"
  | "residency-change"
  | "proposal-deployment"
  | "deferred-grant-activation";

export interface EpochCoordinates {
  readonly organization: string;
  readonly workspace: string;
  readonly agent: string;
  readonly session: string;
  readonly principal: string;
}

export interface EpochReader {
  current(scope: EpochScope, scopeId: string): Epoch;
  currentGlobal(): Epoch;
  vector(coordinates: EpochCoordinates): EpochVector;
}
