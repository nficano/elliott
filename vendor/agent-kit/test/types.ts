import type { Active } from "../src/host/registry/types.js";

export interface MkSkillOpts {
  readonly id: string;
  readonly version?: string;
  readonly provides?: { capability: string; }[];
  readonly secrets?: { name: string; required?: boolean; }[];
  readonly active?: Active;
  readonly onActivate?: (secrets: Record<string, string>) => void;
}
