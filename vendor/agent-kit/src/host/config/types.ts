import type {
  BundleSchema,
  CapabilitySelectionSchema,
  ConfigSchema,
  ModelRow,
  RegistrableBase,
} from "./schema.js";

export type AgentKitConfig = typeof ConfigSchema.Type;
export type RegistrableConfig = typeof RegistrableBase.Type;
export type BundleConfig = typeof BundleSchema.Type;
export type ModelRowT = typeof ModelRow.Type;
export type CapabilitySelectionConfig = typeof CapabilitySelectionSchema.Type;

export interface SecretResolver {
  vault(path: string, field: string): Promise<string>;
  env(name: string): string | undefined;
}

export interface LoadOptions {
  readonly dir: string; // config directory
  readonly env: string; // "dev" | "prod" | …
  /** Base config filename stem (`<appName>.yaml`); the consumer names it, e.g. "agent-oslo". */
  readonly appName?: string;
  readonly resolver?: SecretResolver;
  readonly snapshotPath?: string; // where last-known-good lives
  /**
   * In-memory fragment deep-merged OVER the file layers before interpolation
   * (agent-spec enablement wins, AGENT-SPEC §1.3). Never persisted: snapshots
   * keep only the file-derived source.
   */
  readonly overlay?: Record<string, unknown>;
}

export interface LoadedConfig {
  readonly config: AgentKitConfig;
  /** The merged, pre-interpolation source (placeholders intact) — safe to persist. */
  readonly source: Record<string, unknown>;
}
