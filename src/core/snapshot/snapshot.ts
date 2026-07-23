import { snapshotId } from "../brands";
import { hashValue } from "../digest";
import { deepFreeze } from "../freeze";
import type { SnapshotId } from "../types";
import type { Snapshot, SnapshotInput } from "./types";

export class SnapshotStore {
  readonly #snapshots = new Map<SnapshotId, Snapshot>();

  create(input: SnapshotInput): Snapshot {
    const createdAt = new Date().toISOString();
    const id = snapshotId(hashValue({ ...input, createdAt }));
    const configuration = structuredClone(input.configuration);
    deepFreeze(configuration);
    const components = Object.freeze(
      input.components.map((component) => Object.freeze({ ...component })),
    );
    const common = {
      id,
      createdAt,
      configurationDigest: input.configurationDigest,
      registryDigest: input.registryDigest,
      components,
      configuration,
    };
    const snapshot = input.previous === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, previous: input.previous });
    this.#snapshots.set(id, snapshot);
    return snapshot;
  }

  get(id: SnapshotId): Snapshot | undefined {
    return this.#snapshots.get(id);
  }

  list(): readonly Snapshot[] {
    return [...this.#snapshots.values()];
  }
}
