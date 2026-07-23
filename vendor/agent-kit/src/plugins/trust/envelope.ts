import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { minOrigin, type Origin } from "../../core/types.js";
import { Envelope } from "./schema.js";
import type { Envelope as EnvelopeData } from "./types.js";

export function parseEnvelope(raw: unknown): EnvelopeData | undefined {
  const parsed = Schema.decodeUnknownExit(Envelope)(raw);
  return Exit.isSuccess(parsed) ? parsed.value : undefined;
}

/** A write agent must see BOTH booleans exactly true (§16). */
export function isActionable(env: EnvelopeData): boolean {
  return env.confirmed && env.owner_approved;
}

/** Min-trust across a set of source origins (§7.4 mixed-provenance rule). */
export function minTrustOf(origins: Origin[]): Origin {
  return origins.reduce<Origin>((acc, o) => minOrigin(acc, o), "owner");
}
