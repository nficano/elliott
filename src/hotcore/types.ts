import type { Digest } from "../core/types";

export interface ScanMatch {
  readonly pattern: string;
  readonly endOffset: number;
}

export interface IncrementalScanner {
  push(chunk: string): readonly ScanMatch[];
  reset(): void;
}

export interface IncrementalDigest {
  update(chunk: string | Uint8Array): void;
  digest(): Digest;
}

export interface CompiledPattern {
  readonly pattern: string;
  readonly characters: readonly string[];
  readonly table: readonly number[];
}

export type ScannerBackend = "native" | "typescript";
