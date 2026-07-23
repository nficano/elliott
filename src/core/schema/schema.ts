import {
  IsolationFloorError,
  ManifestValidationError,
  SchemaResolutionError,
} from "../errors";
import type {
  ComponentManifest,
  ComponentSchema,
  IsolationLevel,
  SchemaRef,
} from "../types";

const ISOLATION_ORDER: readonly IsolationLevel[] = [
  "declarative",
  "in-process",
  "process",
  "container",
  "remote",
];

const isolationRank = (level: IsolationLevel): number =>
  ISOLATION_ORDER.indexOf(level);

export const enforceIsolationFloor = (
  requested: IsolationLevel,
  floor: IsolationLevel,
): void => {
  if (isolationRank(requested) < isolationRank(floor)) {
    throw new IsolationFloorError(requested, floor);
  }
};

export class ComponentSchemaRegistry {
  readonly #byDigest = new Map<string, ComponentSchema>();
  readonly #kindDigests = new Map<string, string>();

  register(schema: ComponentSchema): void {
    const knownDigest = this.#kindDigests.get(schema.kind);
    if (knownDigest !== undefined && knownDigest !== schema.digest) {
      throw new ManifestValidationError(
        `kind ${schema.kind} already resolves to schema ${knownDigest}`,
      );
    }
    this.#kindDigests.set(schema.kind, schema.digest);
    this.#byDigest.set(schema.digest, Object.freeze(schema));
  }

  resolve(ref: SchemaRef): ComponentSchema {
    const schema = this.#byDigest.get(ref.digest);
    if (schema === undefined) throw new SchemaResolutionError(ref.digest);
    if (schema.kind !== ref.kind || schema.apiVersion !== ref.apiVersion) {
      throw new ManifestValidationError(
        `schema reference identity does not match ${ref.digest}`,
      );
    }
    return schema;
  }

  validateManifest(
    manifest: ComponentManifest,
    requestedIsolation: IsolationLevel,
  ): ComponentSchema {
    const schema = this.resolve(manifest.schema);
    enforceIsolationFloor(requestedIsolation, schema.minimumIsolation);
    return schema;
  }
}
