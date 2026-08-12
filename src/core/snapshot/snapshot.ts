import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isJsonRecord } from "../../providers/http";
import { componentRef, digest, snapshotId } from "../brands";
import { hashValue } from "../digest";
import { deepFreeze } from "../freeze";
import type { SnapshotId } from "../types";
import type { Snapshot, SnapshotInput } from "./types";

export class SnapshotStore {
  readonly #snapshots = new Map<SnapshotId, Snapshot>();

  constructor(initial: readonly Snapshot[] = []) {
    for (const snapshot of initial) this.#snapshots.set(snapshot.id, snapshot);
  }

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

const decodeSnapshotComponent = (
  value: unknown,
  filePath: string,
): Snapshot["components"][number] => {
  if (
    !isJsonRecord(value) || typeof value["ref"] !== "string"
    || typeof value["manifestDigest"] !== "string"
    || typeof value["configDigest"] !== "string"
  ) throw new TypeError(`${filePath} has an invalid Snapshot Component`);
  return Object.freeze({
    ref: componentRef(value["ref"]),
    manifestDigest: digest(value["manifestDigest"]),
    configDigest: digest(value["configDigest"]),
  });
};

const snapshotString = (
  value: Readonly<Record<string, unknown>>,
  key: string,
  filePath: string,
): string => {
  const field = value[key];
  if (typeof field !== "string") {
    throw new TypeError(`${filePath} has an invalid ${key}`);
  }
  return field;
};

const decodeSnapshot = (source: string, filePath: string): Snapshot => {
  const value: unknown = JSON.parse(source);
  if (
    !isJsonRecord(value) || !Array.isArray(value["components"])
    || !isJsonRecord(value["configuration"])
  ) throw new TypeError(`${filePath} has an invalid Snapshot`);
  const previous = value["previous"];
  if (previous !== undefined && typeof previous !== "string") {
    throw new TypeError(`${filePath} has an invalid previous Snapshot`);
  }
  const configuration = structuredClone(value["configuration"]);
  deepFreeze(configuration);
  return Object.freeze({
    id: snapshotId(snapshotString(value, "id", filePath)),
    createdAt: snapshotString(value, "createdAt", filePath),
    configurationDigest: digest(
      snapshotString(value, "configurationDigest", filePath),
    ),
    registryDigest: digest(
      snapshotString(value, "registryDigest", filePath),
    ),
    components: Object.freeze(
      value["components"].map((component) =>
        decodeSnapshotComponent(component, filePath)
      ),
    ),
    configuration,
    ...(previous !== undefined && { previous: snapshotId(previous) }),
  });
};

const loadSnapshots = (root: string): readonly Snapshot[] => {
  mkdirSync(root, { recursive: true });
  return readdirSync(root)
    .filter((name) => path.extname(name) === ".json")
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => {
      const filePath = path.join(root, name);
      return decodeSnapshot(readFileSync(filePath, "utf8"), filePath);
    });
};

export class FileSnapshotStore extends SnapshotStore {
  readonly #root: string;

  constructor(root: string) {
    const resolvedRoot = path.resolve(root);
    super(loadSnapshots(resolvedRoot));
    this.#root = resolvedRoot;
  }

  override create(input: SnapshotInput): Snapshot {
    const snapshot = super.create(input);
    const filePath = path.join(this.#root, `${snapshot.id}.json`);
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(snapshot, undefined, 2)}\n`,
      { flag: "wx" },
    );
    renameSync(temporaryPath, filePath);
    return snapshot;
  }
}
