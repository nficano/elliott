import * as Data from "effect/Data";
import { formatChain } from "../../core/agent/chain.js";
import type { CallChain } from "../../core/agent/types.js";
import type { CapabilityFailure } from "./types.js";

/**
 * Tagged capability error (§27.3-extended) — a `Data.TaggedError` so it rides
 * Effect's typed error channel. This intentionally remains data-backed because
 * `cause` can carry an arbitrary provider failure. `message` always embeds the
 * formatted chain.
 */
export class CapabilityError extends Data.TaggedError("CapabilityError")<{
  readonly reason: CapabilityFailure;
  readonly detail: string;
  readonly chain: CallChain;
  readonly cause?: unknown;
}> {
  readonly retryable = false; // the bus already exhausted fallbacks
  override get message(): string {
    return `[${this.reason}] ${this.detail} (chain: ${
      formatChain(this.chain)
    })`;
  }
}
