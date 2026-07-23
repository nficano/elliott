import type { ToolMeta } from "../../core/agent/types.js";
import type { GmailClient } from "./email-gmail.js";
import type { ReadConfig } from "./email-read.js";
import type { WriteConfig } from "./email-write.js";

export type ReadCfg = typeof ReadConfig.Type;
export type WriteCfg = typeof WriteConfig.Type;

/** Everything the triage tool closes over (kept ≤3 constructor/factory params). */
export interface TriageDeps {
  readonly gmail: GmailClient;
  readonly meta: ToolMeta;
  readonly cfg: ReadCfg;
  readonly getSelf: () => Promise<string>;
}
