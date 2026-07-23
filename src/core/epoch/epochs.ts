// Kernel-owned monotonic epoch counters — TDD §0d, §1a. Policy changes,
// revocations, activations, and catalog updates bump epochs; per-use paths
// compare vectors and recompute synchronously on mismatch. Bumps are audit
// events (audit-log wiring is deferred to M3).

import type { Epoch, EpochVector, ScopeLevel } from "../types";

const INITIAL_EPOCH = 0 as Epoch;

export class EpochRegistry {
  private global: Epoch = INITIAL_EPOCH;
  private readonly counters = new Map<string, Epoch>();

  current(level: ScopeLevel, scopeId: string): Epoch {
    return this.counters.get(`${level}:${scopeId}`) ?? INITIAL_EPOCH;
  }

  bump(level: ScopeLevel, scopeId: string): Epoch {
    const key = `${level}:${scopeId}`;
    const next = ((this.counters.get(key) ?? INITIAL_EPOCH) + 1) as Epoch;
    this.counters.set(key, next);
    this.global = (this.global + 1) as Epoch;
    return next;
  }

  currentGlobal(): Epoch {
    return this.global;
  }

  vectorMatches(cached: EpochVector, live: EpochVector): boolean {
    return cached.org === live.org
      && cached.workspace === live.workspace
      && cached.agent === live.agent
      && cached.session === live.session
      && cached.principal === live.principal;
  }
}
