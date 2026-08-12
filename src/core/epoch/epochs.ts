import { epoch, scopeId as makeScopeId } from "../brands";
import { hashValue } from "../digest";
import type { Epoch, EpochVector } from "../types";
import type { RecordAppender } from "../waist/types";
import type {
  EpochBumpReason,
  EpochCoordinates,
  EpochReader,
  EpochScope,
} from "./types";

const GLOBAL_SLOT = 0;
const DEFAULT_CAPACITY = 4096;

class SharedEpochReader implements EpochReader {
  readonly #view: Int32Array;
  readonly #slots: ReadonlyMap<string, number>;

  constructor(
    view: Int32Array,
    slots: ReadonlyMap<string, number>,
  ) {
    this.#view = view;
    this.#slots = slots;
  }

  current(scope: EpochScope, scopeId: string): Epoch {
    const slot = this.#slots.get(`${scope}:${scopeId}`);
    return epoch(slot === undefined ? 0 : Atomics.load(this.#view, slot));
  }

  currentGlobal(): Epoch {
    return epoch(Atomics.load(this.#view, GLOBAL_SLOT));
  }

  vector(coordinates: EpochCoordinates): EpochVector {
    return {
      org: this.current("organization", coordinates.organization),
      workspace: this.current("workspace", coordinates.workspace),
      agent: this.current("agent", coordinates.agent),
      session: this.current("session", coordinates.session),
      principal: this.current("principal", coordinates.principal),
    };
  }
}

export class EpochRegistry implements EpochReader {
  readonly #view: Int32Array;
  readonly #slots = new Map<string, number>();
  readonly #records: RecordAppender;
  #nextSlot = 1;

  constructor(
    records: RecordAppender,
    capacity = DEFAULT_CAPACITY,
  ) {
    this.#records = records;
    this.#view = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * capacity),
    );
  }

  current(scope: EpochScope, scopeId: string): Epoch {
    const slot = this.#slots.get(`${scope}:${scopeId}`);
    return epoch(slot === undefined ? 0 : Atomics.load(this.#view, slot));
  }

  currentGlobal(): Epoch {
    return epoch(Atomics.load(this.#view, GLOBAL_SLOT));
  }

  vector(coordinates: EpochCoordinates): EpochVector {
    return this.reader().vector(coordinates);
  }

  reader(): EpochReader {
    return new SharedEpochReader(this.#view, new Map(this.#slots));
  }

  async bump(
    scope: EpochScope,
    scopeId: string,
    reason: EpochBumpReason,
  ): Promise<Epoch> {
    const slot = this.#slot(scope, scopeId);
    const next = epoch(Atomics.load(this.#view, slot) + 1);
    await this.#records.append({
      type: "epoch.bump",
      scope: { level: scope, id: makeScopeId(scopeId) },
      durability: "effect-gating",
      classification: "internal",
      payload: {
        reason,
        next,
        global: Atomics.load(this.#view, GLOBAL_SLOT) + 1,
        eventDigest: hashValue({ scope, scopeId, reason, next }),
      },
    });
    Atomics.store(this.#view, slot, next);
    Atomics.add(this.#view, GLOBAL_SLOT, 1);
    return next;
  }

  vectorMatches(cached: EpochVector, live: EpochVector): boolean {
    return cached.org === live.org
      && cached.workspace === live.workspace
      && cached.agent === live.agent
      && cached.session === live.session
      && cached.principal === live.principal;
  }

  #slot(scope: EpochScope, scopeId: string): number {
    const key = `${scope}:${scopeId}`;
    const known = this.#slots.get(key);
    if (known !== undefined) return known;
    if (this.#nextSlot >= this.#view.length) {
      throw new Error("Epoch table capacity exhausted");
    }
    const slot = this.#nextSlot;
    this.#nextSlot += 1;
    this.#slots.set(key, slot);
    return slot;
  }
}
