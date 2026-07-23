import type * as Redacted from "effect/Redacted";
import type { Inbound } from "../../core/channels/types.js";
import type { Health } from "../../core/types.js";

export interface HttpHandlers {
  health(): Promise<Health>;
  ready(): Promise<Health>;
  reloadConfig(): Promise<
    { applied: boolean; needsRestart: string[]; recovered: boolean; }
  >;
  footprint(sinceIso?: string): Promise<unknown>;
  jobsStatus(): Promise<{ depth: number; }>;
  trigger(
    id: string,
    payload: unknown,
  ): Promise<{ ok: boolean; detail?: string; }>;
  /** Ingress dispatch — the injection screen runs downstream of this (§16). */
  ingress(msg: Inbound): Promise<void>;
  /** Optional homelab event forward (§16.4). */
  event?(topic: string, payload: unknown): Promise<void>;
}

export interface HttpOpts {
  readonly port: number;
  readonly controlToken: Redacted.Redacted<string> | undefined;
  readonly handlers: HttpHandlers;
}
