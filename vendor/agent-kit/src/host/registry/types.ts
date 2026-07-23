import type * as Schema from "effect/Schema";
import type { ToolDef } from "../../core/agent/types.js";
import type { ServiceGet } from "../../core/di/services.js";
import type { Profile, Tier, Trust } from "../../core/types.js";
import type { ContractCatalog } from "../capabilities/contracts.js";
import type {
  CapabilityInvoker,
  ProviderDecl,
  ProviderImpl,
} from "../capabilities/types.js";
import type { AgentKitConfig } from "../config/schema.js";
import type { FootprintLedger } from "../footprint/types.js";
import type { Observability } from "../observability/types.js";

/**
 * A declared secret (CAPABILITIES-TDD §6) — the `workflow_call.secrets` analog.
 * Values are supplied ONLY via the registrable's own config `secrets:` block
 * (interpolated `${VAULT:…}`/`${ENV:…}` by the loader) and never inherited
 * across a registrable boundary.
 */
export interface SecretDecl {
  readonly name: string; // snake_case (§26.6)
  readonly required?: boolean; // default true
  readonly description?: string;
}

/** Cost hints declared on a manifest, refined by measurement (§11.1). */
export interface FootprintHints {
  readonly estColdTokens?: number;
  readonly estInitMs?: number;
}

/** A cron entry contributed by a registrable (§15). */
export interface ScheduleSpec {
  readonly id: string; // schedule/job kind — reuse the registrable id (§26)
  readonly cron: string;
  readonly catchup?: "skip" | "catchup";
  /** Optional deterministic pre-pass; stdout injected as context (§15). */
  readonly script?: string;
  readonly tier?: Tier;
  /** Which notify connector receives this job's output (§16.4). */
  readonly deliverTo?: string[];
  /** Which agent runs the scheduled turn (defaults to the fleet default). */
  readonly agentId?: string;
  /** The instruction the scheduled turn runs (reuses the interactive body, §15). */
  readonly prompt?: string;
}

export interface PromptFragment {
  readonly id: string;
  readonly text: string;
}

export interface LifecycleHooks {
  onBoot?(get: ServiceGet): Promise<void>;
  onTurnStart?(t: unknown): Promise<void>;
  selectBundles?(t: unknown, all: unknown): Promise<string[]>;
  beforeModelResolve?(t: unknown): Promise<unknown>;
  onModelCall?(info: unknown, next: () => Promise<unknown>): Promise<unknown>;
  beforeToolCall?(c: unknown): Promise<"allow" | "block" | "require_approval">;
  onToolCall?(call: unknown, next: () => Promise<string>): Promise<string>;
  onTurnEnd?(t: unknown): Promise<void>;
  onSchedule?(job: unknown): Promise<void>;
}

/** What a manifest CLAIMS to own — cross-checked against reality at activation (§6). */
export interface Contracts {
  readonly tools?: string[];
  readonly channels?: string[];
}

/**
 * Manifest — inspectable WITHOUT executing the registrable's code (§6
 * manifest-before-code). Everything the registry needs to validate, enable, and
 * inventory is cheap static metadata.
 */
// The generic carries the config type through Registrable even though Effect's
// context-free schema type cannot express it without becoming invariant.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Manifest<Cfg = unknown> {
  readonly id: string; // stable, unique, kebab-case (§26)
  readonly kind: "skill" | "mcp" | "plugin" | "agent" | "channel" | "scheduler";
  readonly version: string;
  /**
   * The registrable's config schema (`effect/Schema`). Registry indexing decodes
   * synchronously, so the schema must not require decoding services.
   */
  readonly configSchema: Schema.Decoder<unknown>;
  readonly defaultTier?: Tier;
  readonly defaultProfile?: Profile;
  readonly bundle?: string;
  readonly capabilities?: string[];
  readonly trust?: Trust;
  readonly footprint?: FootprintHints;
  readonly contracts?: Contracts;
  /** Capability contracts this registrable provides (TDD §3.3). */
  readonly provides?: readonly ProviderDecl[];
  /** Declared secrets; the registry scopes + validates the config `secrets:` block. */
  readonly secrets?: readonly SecretDecl[];
}

/** Context handed to `activate()` — only the registrable's OWN validated config slice. */
export interface ActivateCtx<Cfg = unknown> {
  readonly config: Cfg;
  /** Effect-native service locator over the app `Context` (replaces the container). */
  readonly get: ServiceGet;
  readonly tier: Tier;
  readonly profile: Profile;
  /** Exactly the manifest-declared secret names, resolved (TDD §6). Never another registrable's. */
  readonly secrets: Readonly<Record<string, string>>;
  /** Invoke other capabilities through the bus (the `uses:` analog) — undefined in bus-less tests. */
  readonly caps?: CapabilityInvoker;
}

export interface Active {
  readonly tools?: ToolDef[];
  readonly writeTools?: ToolDef[];
  readonly schedules?: ScheduleSpec[];
  readonly promptFragment?: PromptFragment;
  readonly hooks?: LifecycleHooks;
  /** Implementations for every manifest `provides` entry (validated by the bus). */
  readonly providers?: readonly ProviderImpl[];
  stop?(): Promise<void>;
}

export interface Registrable<Cfg = unknown> {
  readonly manifest: Manifest<Cfg>;
  activate(ctx: ActivateCtx<Cfg>): Promise<Active>;
}

/** An indexed-but-not-yet-activated registrable + its validated config. */
export interface IndexedEntry {
  readonly registrable: Registrable;
  readonly config: Record<string, unknown>;
  readonly enabled: boolean;
  /** Declared + supplied secret values, scoped to this registrable (TDD §6). */
  readonly secrets: Readonly<Record<string, string>>;
  active?: Active;
}

export interface Registry {
  /**
   * Index + validate config at boot; does NOT activate (§6 lazy). Accepts
   * multiple versions of one id — the config `version:` range picks exactly one
   * (highest satisfying wins); the rest are indexed as shadowed (TDD §7).
   */
  index(registrables: Registrable[]): void;
  /** Lazily activate one registrable by id (first bundle selection / first use). */
  activate(id: string): Promise<Active>;
  /** Activate everything a bundle needs (called when the router selects it). */
  activateBundle(bundle: string): Promise<Active[]>;
  get(id: string): IndexedEntry | undefined;
  all(): IndexedEntry[];
  /** Enabled registrable ids declaring a given capability ref (TDD §3.3). */
  providersOf(ref: string): string[];
  /** All contributed prompt fragments from activated registrables (§10.2). */
  promptFragments(): PromptFragment[];
  /** doctor/inventory — reads manifests only, no activation (§6). */
  inventory(): {
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
    shadowed?: boolean;
    trust?: Trust;
  }[];
  stop(): Promise<void>;
}

export interface RegistryDeps {
  readonly config: AgentKitConfig;
  /** Service locator over the app `Context`, forwarded to each `activate()` (§4). */
  readonly get: ServiceGet;
  readonly obs: Observability;
  readonly footprint: FootprintLedger;
  /** Contract catalog for validating `provides` refs (TDD §3.3). */
  readonly catalog?: ContractCatalog;
  /** Late-bound capability bus for ActivateCtx.caps (bus needs the registry first). */
  readonly caps?: () => CapabilityInvoker | undefined;
}

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface ShadowedEntry {
  readonly id: string;
  readonly version: string;
  readonly kind: string;
  readonly trust?: Trust;
}

export interface RegistryIndexState {
  readonly entries: Map<string, IndexedEntry>;
  readonly shadowed: ShadowedEntry[];
  /** capability ref → enabled registrable ids that provide it. */
  readonly providerIndex: Map<string, string[]>;
}

export interface GroupOptions {
  readonly id: string;
  readonly group: Registrable[];
  readonly deps: RegistryDeps;
  readonly state: RegistryIndexState;
}

export interface InventoryItem {
  readonly id: string;
  readonly kind: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly shadowed?: boolean;
  readonly trust?: Trust;
}
