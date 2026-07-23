/**
 * Alert hygiene (CAPABILITIES-TDD §9.3) — the dedupe/cooldown primitives every
 * reactive loop needs. In-memory and restart-volatile BY DESIGN: the worst
 * case after a restart is one duplicate look, which beats dragging a store into
 * the hot path. Clocks are injected so tests are deterministic.
 */
import type { Cooldown, SeenSet } from "./types.js";

const DEFAULT_MAX_SEEN_KEYS = 1000;

/** Bounded, TTL-pruned set of already-handled keys. */
export function makeSeenSet(
  opts: { ttlMs: number; max?: number; now?: () => number; },
): SeenSet {
  const now = opts.now ?? (() => Date.now());
  const max = opts.max ?? DEFAULT_MAX_SEEN_KEYS;
  const seen = new Map<string, number>(); // key → seenAt

  return {
    has: (key) => {
      const at = seen.get(key);
      if (at === undefined) return false;
      if (now() - at > opts.ttlMs) {
        seen.delete(key);
        return false;
      }
      return true;
    },
    add: (key) => {
      seen.set(key, now());
      if (seen.size > max) {
        // One insertion can exceed the fixed cap by only one entry. Scan once
        // instead of sorting and materializing the whole map.
        let oldestKey: string | undefined;
        let oldestAt = Infinity;
        for (const [candidate, at] of seen) {
          if (oldestKey !== undefined && at >= oldestAt) continue;
          oldestKey = candidate;
          oldestAt = at;
        }
        if (oldestKey !== undefined) seen.delete(oldestKey);
      }
    },
    prune: () => {
      const cutoff = now() - opts.ttlMs;
      for (const [k, at] of seen) if (at < cutoff) seen.delete(k);
    },
    size: () => seen.size,
  };
}

/** Flap cooldown: a resolve→regress→resolve issue must not re-run an expensive
 *  response on every recurrence (prior art: 6 h per issue key). */
export function makeCooldown(
  opts: { windowMs: number; now?: () => number; },
): Cooldown {
  const now = opts.now ?? (() => Date.now());
  const last = new Map<string, number>();

  return {
    active: (key) => {
      const at = last.get(key);
      return at !== undefined && now() - at < opts.windowMs;
    },
    touch: (key) => last.set(key, now()),
    prune: () => {
      const cutoff = now() - opts.windowMs;
      for (const [k, at] of last) if (at < cutoff) last.delete(k);
    },
  };
}
