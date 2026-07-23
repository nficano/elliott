import { ConfigError } from "../../core/errors.js";
import { indexRegistrables } from "./indexing.js";
import type {
  Active,
  IndexedEntry,
  InventoryItem,
  PromptFragment,
  Registrable,
  Registry,
  RegistryDeps,
  RegistryIndexState,
  ShadowedEntry,
} from "./types.js";
import {
  claimTools,
  crossCheckContracts,
  crossCheckProviders,
  recordStatic,
} from "./validation.js";

export function makeRegistry(deps: RegistryDeps): Registry {
  return new DefaultRegistry(deps);
}

class DefaultRegistry implements Registry {
  private readonly entries = new Map<string, IndexedEntry>();
  private readonly shadowed: ShadowedEntry[] = [];
  private readonly toolOwner = new Map<string, string>();
  private readonly providerIndex = new Map<string, string[]>();

  constructor(private readonly deps: RegistryDeps) {}

  index(registrables: Registrable[]): void {
    indexRegistrables(registrables, this.deps, this.indexState());
  }

  async activate(id: string): Promise<Active> {
    const entry = this.entries.get(id);
    if (!entry) throw new ConfigError({ message: `no registrable '${id}'` });
    if (entry.active) return entry.active;
    if (!entry.enabled) {
      throw new ConfigError({ message: `registrable '${id}' is disabled` });
    }
    const manifest = entry.registrable.manifest;
    const tier = (entry.config.tier as never) ?? manifest.defaultTier ?? "fast";
    const caps = this.deps.caps?.();
    const active = await this.deps.obs.span(
      "agentkit.activate",
      { "agentkit.component.id": id },
      () =>
        entry.registrable.activate({
          config: entry.config,
          get: this.deps.get,
          tier,
          profile: manifest.defaultProfile ?? {},
          secrets: entry.secrets,
          ...(caps && { caps }),
        }),
    );
    this.validateActivation(id, active);
    entry.active = active;
    return active;
  }

  async activateBundle(bundle: string): Promise<Active[]> {
    const ids = this.entries.values()
      .filter((entry) =>
        entry.enabled && entry.registrable.manifest.bundle === bundle
      )
      .map((entry) => entry.registrable.manifest.id)
      .toArray();
    const active: Active[] = [];
    for (const id of ids) active.push(await this.activate(id));
    return active;
  }

  get(id: string): IndexedEntry | undefined {
    return this.entries.get(id);
  }

  all(): IndexedEntry[] {
    return [...this.entries.values()];
  }

  providersOf(ref: string): string[] {
    return [...(this.providerIndex.get(ref) ?? [])];
  }

  promptFragments(): PromptFragment[] {
    const fragments: PromptFragment[] = [];
    for (const entry of this.entries.values()) {
      if (entry.active?.promptFragment) {
        fragments.push(entry.active.promptFragment);
      }
    }
    return fragments;
  }

  inventory(): InventoryItem[] {
    return [
      ...[...this.entries.values()].map(liveInventoryItem),
      ...this.shadowed.map(shadowedInventoryItem),
    ];
  }

  async stop(): Promise<void> {
    for (const entry of this.entries.values()) {
      try {
        await entry.active?.stop?.();
      } catch {
        // Best-effort teardown.
      }
    }
  }

  private indexState(): RegistryIndexState {
    return {
      entries: this.entries,
      shadowed: this.shadowed,
      providerIndex: this.providerIndex,
    };
  }

  private validateActivation(id: string, active: Active): void {
    const manifest = this.entries.get(id)!.registrable.manifest;
    crossCheckContracts(manifest, active);
    crossCheckProviders(manifest, active);
    claimTools(manifest.id, active, this.toolOwner);
    recordStatic(this.deps.footprint, manifest.id, active);
  }
}

function liveInventoryItem(entry: IndexedEntry): InventoryItem {
  const manifest = entry.registrable.manifest;
  return {
    id: manifest.id,
    kind: manifest.kind,
    version: manifest.version,
    enabled: entry.enabled,
    ...(manifest.trust && { trust: manifest.trust }),
  };
}

function shadowedInventoryItem(entry: ShadowedEntry): InventoryItem {
  return {
    id: entry.id,
    kind: entry.kind,
    version: entry.version,
    enabled: false,
    shadowed: true,
    ...(entry.trust && { trust: entry.trust }),
  };
}
