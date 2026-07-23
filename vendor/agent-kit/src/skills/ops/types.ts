import type { CapabilityInvoker } from "../../host/capabilities/types.js";
import type { SpikeWatchConfig } from "./schema.js";

export type Cfg = typeof SpikeWatchConfig.Type;

export interface SeenSet {
  has(key: string): boolean;
  add(key: string): void;
  prune(): void;
  size(): number;
}

export interface Cooldown {
  /** True when the key is still inside its cooldown window. */
  active(key: string): boolean;
  /** Mark the key handled now (starts/restarts its window). */
  touch(key: string): void;
  prune(): void;
}

export interface SelfIdentity {
  /** The agent's project/component slug in the alert source (e.g. "main"). */
  readonly projectSlug: string;
  /** The source's numeric/opaque project id, if it appears in permalinks. */
  readonly projectId?: string;
}

export interface AlertSignals {
  /** Short id like "MAIN-1A2" — the segment before the first hyphen is the project. */
  readonly shortId?: string;
  readonly project?: string;
  readonly url?: string;
}

export interface FeedItem {
  readonly key: string;
  readonly title: string;
  readonly count: number;
  readonly users?: number;
  readonly firstSeen?: string;
  readonly url?: string;
  readonly project?: string;
}

export interface ChangeEvent {
  readonly ref: string;
  readonly title: string;
  readonly at: string; // ISO
  readonly url?: string;
  readonly ok: boolean;
}

export interface SpikeOptions {
  /** Volume floor — an item below it is noise (and is NOT marked seen, so it
   *  can still alert later when it grows). */
  readonly minCount: number;
  readonly seen: SeenSet;
  readonly ignoreSubstrings?: readonly string[];
  readonly isSelf?: (item: FeedItem) => boolean;
}

export interface SpikeWatchOverrides {
  readonly now?: () => number;
}

export interface SpikeRuntime {
  readonly cfg: Cfg;
  readonly caps?: CapabilityInvoker;
  readonly seen: SeenSet;
  readonly cooldown: Cooldown;
  readonly selfIdentity: SelfIdentity | null;
  isBaselineSeeded: boolean;
}
