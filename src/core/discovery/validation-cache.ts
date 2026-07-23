import type { Digest } from "../types";
import type { ValidationCacheEntry, ValidationCacheQuery } from "./types";

const sameDigests = (
  left: readonly Digest[],
  right: readonly Digest[],
): boolean =>
  left.length === right.length
  && left.every((value, index) => value === right[index]);

export class ValidationCache {
  readonly #entries = new Map<Digest, ValidationCacheEntry>();

  get(query: ValidationCacheQuery): ValidationCacheEntry | undefined {
    const entry = this.#entries.get(query.packageDigest);
    if (
      entry === undefined
      || entry.provenanceTrustRoot !== query.provenanceTrustRoot
      || entry.validationLogicVersion !== query.validationLogicVersion
      || !sameDigests(entry.schemaDigests, query.schemaDigests)
    ) return undefined;
    return entry;
  }

  put(entry: ValidationCacheEntry): void {
    this.#entries.set(
      entry.packageDigest,
      Object.freeze({
        ...entry,
        schemaDigests: Object.freeze([...entry.schemaDigests]),
      }),
    );
  }

  evict(packageDigest: Digest): void {
    this.#entries.delete(packageDigest);
  }
}
