import type { ToolDef } from "../../core/agent/types.js";
import type { ToolSchema } from "../../core/llm/types.js";
import type { Registry } from "../registry/types.js";
import type { TurnCtx } from "../runtime/types.js";
import type { StaticEmbedder } from "./embed.js";

/**
 * Bundle router (§10.1). Selects stable *bundles* (not individual tools) so the
 * cache prefix stays warm, and exposes the long tail behind `search_tools` +
 * `invoke_tool`. Runs OFF the network critical path — static in-process
 * embeddings + Postgres FTS fused via RRF, no LiteLLM round-trip.
 */

export interface BundleInfo {
  readonly name: string;
  /** Global ordinal for deterministic serialization (§10.1). */
  readonly order: number;
}

export interface BundleIndex {
  readonly bundles: BundleInfo[];
}

/** The toolset materialized for a turn: cached-prefix tools only (§10.1). */
export interface Toolset {
  /** Immutable per session: core tools + selected bundles + search/invoke meta-tools. */
  readonly tools: ToolSchema[];
  /** The concrete ToolDefs behind the schemas, for dispatch. */
  readonly defs: Map<string, ToolDef>;
  /** Whether disclosure is engaged (deferrable schemas over threshold, §10.1). */
  readonly disclosureEngaged: boolean;
}

export interface SearchHit {
  readonly name: string;
  readonly description: string;
  readonly score: number;
}

export interface Router {
  /** Rank + select bundles for a turn (RRF over BM25 + static cosine). */
  selectBundles(t: TurnCtx, query: string): Promise<string[]>;
  /**
   * Build the immutable toolset for the selected bundles (deterministic order).
   * `safe` pins an untrusted-surface turn to read-only tools — no delegate/notify/
   * write/exec (§16 untrusted-surface bundle).
   */
  buildToolset(
    t: TurnCtx,
    bundles: string[],
    opts?: { safe?: boolean; },
  ): Promise<Toolset>;
  /** Long-tail discovery for `search_tools` (§10.1). */
  searchTools(query: string, limit?: number): Promise<SearchHit[]>;
  /** Resolve a long-tail tool by name for `invoke_tool` dispatch (§10.1). */
  resolveTool(name: string): ToolDef | undefined;
  /** Drop the cached tool catalog so the next turn rebuilds it (after config reload). */
  invalidateCatalog(): void;
}

export interface Doc {
  readonly id: string;
  readonly text: string;
}

export interface RouterDeps {
  readonly registry: Registry;
  readonly embedder: StaticEmbedder;
  /** Curated per-bundle descriptions for ranking (§26.4 closed vocabulary). */
  readonly bundleDescriptions: Record<string, string>;
  /** Global bundle ordinal for deterministic serialization (§10.1). */
  readonly bundleOrder: string[];
  /** Always-loaded core tools — never deferred (§10.1). */
  coreTools(): ToolDef[];
  /** Context window for the turn's model (feeds the disclosure threshold). */
  contextWindowFor(t: TurnCtx): number;
  /** Fixed cutoff when the window is unknown (~20K, §10.1). */
  readonly disclosureCutoffTokens: number;
  /** Max concurrent bundles so the cache-variant space stays small (~3, §10.1). */
  readonly maxBundles: number;
  /** Called when a registrable fails to activate during catalog build (§1.4). */
  onCatalogError?(componentId: string, message: string): void;
}

export interface CatalogEntry {
  readonly def: ToolDef;
  readonly bundle: string;
  readonly core: boolean;
}

export interface Bm25Index {
  readonly docs: {
    id: string;
    toks: string[];
    raw: string;
    tf: Map<string, number>;
  }[];
  readonly avgLen: number;
  readonly df: Map<string, number>;
}

export interface SearchEntry {
  readonly entry: CatalogEntry;
  readonly blob: string;
  readonly embedding: Float32Array;
}

export type RouterAccess = Pick<Router, "resolveTool" | "searchTools">;

export interface MetaTools {
  readonly search: ToolDef;
  readonly invoke: ToolDef;
}
