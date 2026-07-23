import type { Profile, Tier } from "../../core/types.js";
import type { AgentKitConfig } from "../config/schema.js";

export interface Price {
  readonly in: number;
  readonly out: number;
  readonly cacheRead: number;
}

export interface ResolveModelOptions {
  readonly cfg: AgentKitConfig;
  readonly tier: Tier;
  readonly profileName?: string;
  readonly profileOverride?: Profile;
}

export interface ResolvedProfile {
  readonly pin: string | undefined;
  readonly maxTokens: number;
  readonly temperature: number;
}
