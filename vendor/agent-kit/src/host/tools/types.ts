import type { MemoryPort } from "../../core/memory/types.js";
import type { NotifyPort } from "../../core/notify/types.js";

/**
 * Framework core tools (§10.1): "Memory/delegate/notify/ask stay in the cached
 * prefix unconditionally." Never deferred behind the search meta-tool. `delegate`
 * joins this set in M4 once the job system exists.
 */
export interface CoreToolDeps {
  readonly memory?: MemoryPort;
  readonly notify?: NotifyPort;
  /** Enabled channel ids — gates the `channel_formatting` guide tool. */
  readonly channels?: readonly string[];
}
