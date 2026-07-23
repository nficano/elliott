import type {
  CacheCodec,
  CacheResolution,
  VersionedCacheEntry,
  VersionStamp,
} from "./types";

const sameStamp = (left: VersionStamp, right: VersionStamp): boolean =>
  left.epochs.org === right.epochs.org
  && left.epochs.workspace === right.epochs.workspace
  && left.epochs.agent === right.epochs.agent
  && left.epochs.session === right.epochs.session
  && left.epochs.principal === right.epochs.principal
  && left.digests.length === right.digests.length
  && left.digests.every((value, index) => value === right.digests[index]);

export class VersionedCache<Value> {
  readonly #entries = new Map<string, VersionedCacheEntry<Value>>();
  readonly #codec: CacheCodec<Value>;

  constructor(codec: CacheCodec<Value>) {
    this.#codec = codec;
  }

  async resolve(
    key: string,
    stamp: VersionStamp,
    recompute: () => Promise<Value>,
  ): Promise<CacheResolution<Value>> {
    const cached = this.#entries.get(key);
    let source: CacheResolution<Value>["source"] = "miss";
    if (cached !== undefined && sameStamp(cached.stamp, stamp)) {
      if (
        this.#codec.is(cached.value)
        && this.#codec.digest(cached.value) === cached.valueDigest
      ) {
        return { value: cached.value, source: "hit" };
      }
      source = "corrupt";
    } else if (cached !== undefined) {
      source = "stale";
    }
    this.#entries.delete(key);
    const value = await recompute();
    this.#entries.set(key, {
      key,
      stamp,
      value,
      valueDigest: this.#codec.digest(value),
    });
    return { value, source };
  }

  putUnsafeForTest(key: string, entry: VersionedCacheEntry<Value>): void {
    this.#entries.set(key, entry);
  }

  clear(): void {
    this.#entries.clear();
  }
}
