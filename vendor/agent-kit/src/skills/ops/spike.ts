import type { ChangeEvent, FeedItem, SpikeOptions } from "./types.js";

/**
 * Deterministic spike selection + change correlation (CAPABILITIES-TDD §9.3).
 * No LLM anywhere in the detection path — everything here is testable code;
 * only the narration (if any) is a model's job. Null-vs-empty is load-bearing:
 * a FAILED feed fetch is `null` and must never seed the baseline or mark items
 * seen — otherwise the whole backlog floods as "new" on the next good poll.
 */

/** Pure selection: over the floor, not seen, not ignored, not about ourselves. */
export function selectSpikes(
  items: readonly FeedItem[],
  opts: SpikeOptions,
): FeedItem[] {
  const ignore = opts.ignoreSubstrings ?? [];
  return items.filter((item) => {
    if (item.count < opts.minCount) return false;
    if (opts.seen.has(item.key)) return false;
    if (
      ignore.some((s) =>
        s && item.title.toLowerCase().includes(s.toLowerCase())
      )
    ) return false;
    if (opts.isSelf?.(item)) return false;
    return true;
  });
}

/** Only items at/over the floor get marked seen (quiet items may still grow). */
export function markSeen(
  items: readonly FeedItem[],
  opts: Pick<SpikeOptions, "minCount" | "seen">,
): void {
  for (const item of items) {
    if (item.count >= opts.minCount) opts.seen.add(item.key);
  }
}

/**
 * The most recent SUCCESSFUL change that landed within `windowMs` BEFORE the
 * spike first appeared — "might be deploy-related", never "is caused by".
 */
export function correlateChange(
  spikeFirstSeen: string | undefined,
  changes: readonly ChangeEvent[],
  windowMs: number,
): ChangeEvent | null {
  if (!spikeFirstSeen) return null;
  const spikeAt = Date.parse(spikeFirstSeen);
  if (Number.isNaN(spikeAt)) return null;
  let best: ChangeEvent | null = null;
  for (const change of changes) {
    if (!change.ok) continue;
    const at = Date.parse(change.at);
    if (Number.isNaN(at) || at > spikeAt || spikeAt - at > windowMs) continue;
    if (!best || at > Date.parse(best.at)) best = change;
  }
  return best;
}
