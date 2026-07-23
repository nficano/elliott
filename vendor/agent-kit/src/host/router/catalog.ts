import type { ToolDef } from "../../core/agent/types.js";
import { errorMessage } from "../../core/errors.js";
import { buildBm25Index } from "./bm25.js";
import type {
  Bm25Index,
  CatalogEntry,
  RouterDeps,
  SearchEntry,
} from "./types.js";

const EMBED_CACHE_MAX_ENTRIES = 512;

export type { SearchEntry } from "./types.js";

export class RouterCatalog {
  private catalog: Map<string, CatalogEntry> | undefined;
  private catalogBuild: Promise<Map<string, CatalogEntry>> | undefined;
  private embedCache: Map<string, Float32Array> | undefined;
  private searchEntries: SearchEntry[] | undefined;
  private searchIndex: Bm25Index | undefined;

  constructor(private readonly deps: RouterDeps) {}

  ensure(): Promise<Map<string, CatalogEntry>> {
    if (this.catalog) return Promise.resolve(this.catalog);
    this.catalogBuild ??= this.build();
    return this.catalogBuild;
  }

  invalidate(): void {
    this.catalog = undefined;
    this.catalogBuild = undefined;
    this.searchEntries = undefined;
    this.searchIndex = undefined;
  }

  resolve(name: string): ToolDef | undefined {
    return this.catalog?.get(name)?.def;
  }

  embed(text: string): Float32Array {
    this.embedCache ??= new Map();
    const cached = this.embedCache.get(text);
    if (cached) return this.refreshCachedEmbedding(text, cached);
    const embedding = this.deps.embedder.embed(text);
    this.evictOldestEmbedding();
    this.embedCache.set(text, embedding);
    return embedding;
  }

  searchState(): {
    readonly entries: SearchEntry[];
    readonly index: Bm25Index;
  } {
    return { entries: this.searchEntries!, index: this.searchIndex! };
  }

  private async build(): Promise<Map<string, CatalogEntry>> {
    const catalog = new Map<string, CatalogEntry>();
    this.addCoreTools(catalog);
    await this.addRegistryTools(catalog);
    this.commit(catalog);
    return catalog;
  }

  private addCoreTools(catalog: Map<string, CatalogEntry>): void {
    for (const def of this.deps.coreTools()) {
      catalog.set(def.name, { def, bundle: "core", core: true });
    }
  }

  private async addRegistryTools(
    catalog: Map<string, CatalogEntry>,
  ): Promise<void> {
    for (const entry of this.deps.registry.all()) {
      if (
        !entry.enabled || !isToolRegistrant(entry.registrable.manifest.kind)
      ) {
        continue;
      }
      try {
        const active = await this.deps.registry.activate(
          entry.registrable.manifest.id,
        );
        for (
          const def of [
            ...(active.tools ?? []),
            ...(active.writeTools ?? []),
          ]
        ) {
          catalog.set(def.name, {
            def,
            bundle: def.meta.bundle,
            core: def.meta.core,
          });
        }
      } catch (error) {
        this.deps.onCatalogError?.(
          entry.registrable.manifest.id,
          errorMessage(error),
        );
      }
    }
  }

  private commit(catalog: Map<string, CatalogEntry>): void {
    this.catalog = catalog;
    this.catalogBuild = undefined;
    this.embedCache = undefined;
    this.searchEntries = [...catalog.values()]
      .filter((entry) => !entry.core)
      .map((entry) => {
        const blob = searchBlob(entry.def);
        return { entry, blob, embedding: this.deps.embedder.embed(blob) };
      });
    this.searchIndex = buildBm25Index(
      this.searchEntries.map(({ entry, blob }) => ({
        id: entry.def.name,
        text: blob,
      })),
    );
  }

  private refreshCachedEmbedding(
    text: string,
    embedding: Float32Array,
  ): Float32Array {
    this.embedCache!.delete(text);
    this.embedCache!.set(text, embedding);
    return embedding;
  }

  private evictOldestEmbedding(): void {
    if (this.embedCache!.size < EMBED_CACHE_MAX_ENTRIES) return;
    const oldest = this.embedCache!.keys().next().value;
    if (oldest !== undefined) this.embedCache!.delete(oldest);
  }
}

function isToolRegistrant(kind: string): boolean {
  return kind !== "channel" && kind !== "plugin" && kind !== "scheduler";
}

/** BM25 search blob = name (split) + description + top-level param names. */
function searchBlob(def: ToolDef): string {
  const paramNames = Object.keys(
    (def.parameters as { properties?: object; }).properties ?? {},
  );
  return `${def.name.replaceAll(/[_.]/g, " ")} ${def.description} ${
    paramNames.join(" ")
  }`;
}
