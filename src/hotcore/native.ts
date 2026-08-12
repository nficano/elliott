import { createRequire } from "node:module";
import type { IncrementalScanner, ScanMatch } from "./types";

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isUnknownArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

const decodeMatch = (value: unknown): ScanMatch => {
  if (!isRecord(value)) throw new TypeError("Invalid native scanner match");
  const pattern = value["pattern"];
  const endOffset = value["endOffset"];
  if (
    typeof pattern !== "string"
    || typeof endOffset !== "number"
    || !Number.isSafeInteger(endOffset)
    || endOffset < 0
  ) {
    throw new TypeError("Invalid native scanner match");
  }
  return Object.freeze({ pattern, endOffset });
};

const decodeMatches = (value: unknown): readonly ScanMatch[] => {
  if (!isUnknownArray(value)) {
    throw new TypeError("Invalid native scanner response");
  }
  return Object.freeze(value.map(decodeMatch));
};

const loadNativeFactory = ():
  | ((patterns: readonly string[]) => unknown)
  | undefined =>
{
  try {
    const require = createRequire(import.meta.url);
    const addon: unknown = require("../../native/elliott-hot-core.node");
    if (!isRecord(addon)) return undefined;
    const constructor = addon["NativeScanner"];
    if (typeof constructor !== "function") return undefined;
    return (patterns): unknown => {
      const instance: unknown = Reflect.construct(constructor, [[...patterns]]);
      return instance;
    };
  } catch {
    return undefined;
  }
};

const nativeFactory = loadNativeFactory();

class NativeIncrementalScanner implements IncrementalScanner {
  readonly #inner: Readonly<Record<string, unknown>>;

  constructor(
    factory: (patterns: readonly string[]) => unknown,
    patterns: readonly string[],
  ) {
    const inner = factory(patterns);
    if (!isRecord(inner)) throw new TypeError("Invalid native scanner");
    this.#inner = inner;
  }

  push(chunk: string): readonly ScanMatch[] {
    const push = this.#inner["push"];
    if (typeof push !== "function") {
      throw new TypeError("Native scanner does not implement push");
    }
    const output: unknown = Reflect.apply(push, this.#inner, [chunk]);
    return decodeMatches(output);
  }

  reset(): void {
    const reset = this.#inner["reset"];
    if (typeof reset !== "function") {
      throw new TypeError("Native scanner does not implement reset");
    }
    Reflect.apply(reset, this.#inner, []);
  }
}

export const isNativeScannerAvailable = (): boolean =>
  nativeFactory !== undefined;

export const createNativeScanner = (
  patterns: readonly string[],
): IncrementalScanner | undefined =>
  nativeFactory === undefined
    ? undefined
    : new NativeIncrementalScanner(nativeFactory, patterns);
