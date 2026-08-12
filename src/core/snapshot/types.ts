import type { ComponentRef, Digest, SnapshotId } from "../types";

export interface SnapshotComponent {
  readonly ref: ComponentRef;
  readonly manifestDigest: Digest;
  readonly configDigest: Digest;
}

export interface Snapshot {
  readonly id: SnapshotId;
  readonly createdAt: string;
  readonly configurationDigest: Digest;
  readonly registryDigest: Digest;
  readonly components: readonly SnapshotComponent[];
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly previous?: SnapshotId;
}

export interface SnapshotInput {
  readonly configurationDigest: Digest;
  readonly registryDigest: Digest;
  readonly components: readonly SnapshotComponent[];
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly previous?: SnapshotId;
}
