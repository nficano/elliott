/**
 * skills/ops (CAPABILITIES-TDD §9.3) — deterministic spike triage over
 * `issue-feed@1`, alert hygiene primitives, and the self-reference guard.
 * Disabled by default (§5).
 */
export { makeCooldown, makeSeenSet } from "./hygiene.js";
export { isSelfReference } from "./self-guard.js";
export { opsPack, spikeWatchSkill } from "./skills.js";
export { correlateChange, markSeen, selectSpikes } from "./spike.js";
export type {
  AlertSignals,
  ChangeEvent,
  Cooldown,
  FeedItem,
  SeenSet,
  SelfIdentity,
  SpikeOptions,
  SpikeWatchOverrides,
} from "./types.js";
