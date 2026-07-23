import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { digest } from "../core/brands";
import { hashValue } from "../core/digest";
import type { Digest } from "../core/types";
import type {
  CompiledPattern,
  IncrementalDigest,
  IncrementalScanner,
  ScanMatch,
} from "./types";

const prefixTable = (pattern: string): readonly number[] => {
  const table = Array.from({ length: pattern.length }, () => 0);
  let prefix = 0;
  for (let index = 1; index < pattern.length;) {
    if (pattern[index] === pattern[prefix]) {
      prefix += 1;
      table[index] = prefix;
      index += 1;
    } else if (prefix > 0) {
      prefix = table[prefix - 1] ?? 0;
    } else {
      index += 1;
    }
  }
  return table;
};

const advancePattern = (
  compiled: CompiledPattern,
  state: number,
  character: string,
): number => {
  let next = state;
  while (next > 0 && character !== compiled.pattern[next]) {
    next = compiled.table[next - 1] ?? 0;
  }
  return character === compiled.pattern[next] ? next + 1 : next;
};

export class LinearDfaScanner implements IncrementalScanner {
  readonly #compiled: readonly CompiledPattern[];
  readonly #states: number[];
  #offset = 0;

  constructor(patterns: readonly string[]) {
    if (patterns.some((pattern) => pattern.length === 0)) {
      throw new Error("Scanner patterns cannot be empty");
    }
    this.#compiled = Object.freeze(patterns.map((pattern) => ({
      pattern,
      table: prefixTable(pattern),
    })));
    this.#states = patterns.map(() => 0);
  }

  push(chunk: string): readonly ScanMatch[] {
    const matches: ScanMatch[] = [];
    for (const character of chunk) {
      this.#scanCharacter(character, matches);
      this.#offset += 1;
    }
    return matches;
  }

  reset(): void {
    this.#states.fill(0);
    this.#offset = 0;
  }

  #scanCharacter(character: string, matches: ScanMatch[]): void {
    for (let index = 0; index < this.#compiled.length; index += 1) {
      const compiled = this.#compiled[index];
      if (compiled === undefined) continue;
      let state = advancePattern(
        compiled,
        this.#states[index] ?? 0,
        character,
      );
      if (state === compiled.pattern.length) {
        matches.push({
          pattern: compiled.pattern,
          endOffset: this.#offset + 1,
        });
        state = compiled.table[state - 1] ?? 0;
      }
      this.#states[index] = state;
    }
  }
}

export class Sha256IncrementalDigest implements IncrementalDigest {
  #hasher: Hash = createHash("sha256");
  #completed = false;

  update(chunk: string | Uint8Array): void {
    if (this.#completed) throw new Error("Digest already finalized");
    this.#hasher.update(chunk);
  }

  digest(): Digest {
    if (this.#completed) throw new Error("Digest already finalized");
    this.#completed = true;
    return digest(`sha256:${this.#hasher.digest("hex")}`);
  }
}

export const auditChainLink = (
  previous: Digest | undefined,
  payload: unknown,
): Digest => hashValue({ previous, payload });

export type * from "./types";
