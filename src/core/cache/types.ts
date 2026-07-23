import type { Digest, EpochVector } from "../types";

export interface VersionStamp {
  readonly epochs: EpochVector;
  readonly digests: readonly Digest[];
}

export interface VersionedCacheEntry<Value> {
  readonly key: string;
  readonly stamp: VersionStamp;
  readonly value: Value;
  readonly valueDigest: Digest;
}

export interface CacheCodec<Value> {
  readonly is: (value: unknown) => value is Value;
  readonly digest: (value: Value) => Digest;
}

export interface CacheResolution<Value> {
  readonly value: Value;
  readonly source: "hit" | "miss" | "stale" | "corrupt";
}
