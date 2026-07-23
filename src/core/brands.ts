import * as Brand from "effect/Brand";
import type {
  ComponentRef,
  Digest,
  Epoch,
  GrantHandle,
  PlacementRef,
  PrincipalId,
  ProtocolId,
  ScopeId,
  SnapshotId,
} from "./types";

export const componentRef = Brand.nominal<ComponentRef>();
export const digest = Brand.nominal<Digest>();
export const epoch = Brand.nominal<Epoch>();
export const grantHandle = Brand.nominal<GrantHandle>();
export const placementRef = Brand.nominal<PlacementRef>();
export const principalId = Brand.nominal<PrincipalId>();
export const protocolId = Brand.nominal<ProtocolId>();
export const scopeId = Brand.nominal<ScopeId>();
export const snapshotId = Brand.nominal<SnapshotId>();
