import type { ToolDef } from "../../core/agent/types.js";
import type { ToolSchema } from "../../core/llm/types.js";
import type { TurnCtx } from "../runtime/types.js";
import { bm25Rank, rankBm25, rrf } from "./bm25.js";
import { RouterCatalog } from "./catalog.js";
import { makeMetaTools } from "./meta-tools.js";
import type {
  CatalogEntry,
  Doc,
  MetaTools,
  Router,
  RouterDeps,
  SearchHit,
  Toolset,
} from "./types.js";

const DEFAULT_SEARCH_RESULT_LIMIT = 8;
const DISCLOSURE_CONTEXT_FRACTION = 0.1;
const UNKNOWN_BUNDLE_RANK = 999;
const SAFE_CORE_DENY = new Set(["delegate", "notify"]);

export function makeRouter(deps: RouterDeps): Router {
  const catalog = new RouterCatalog(deps);
  const routerAccess = {
    searchTools: (query: string, limit = DEFAULT_SEARCH_RESULT_LIMIT) =>
      searchTools({ deps, catalog, query, limit }),
    resolveTool: (name: string) => catalog.resolve(name),
  };
  const metaTools = makeMetaTools(routerAccess);
  const router: Router = {
    selectBundles: (_turn, query) => selectBundles({ deps, catalog, query }),
    buildToolset: (turn, bundles, opts) =>
      buildToolset({
        deps,
        catalog,
        metaTools,
        turn,
        bundles,
        safe: opts?.safe === true,
      }),
    searchTools: routerAccess.searchTools,
    resolveTool: routerAccess.resolveTool,
    invalidateCatalog: () => catalog.invalidate(),
  };
  return router;
}

async function selectBundles({
  deps,
  catalog,
  query,
}: {
  readonly deps: RouterDeps;
  readonly catalog: RouterCatalog;
  readonly query: string;
}): Promise<string[]> {
  const queryEmbedding = catalog.embed(query);
  const docs: Doc[] = deps.bundleOrder.map((name) => ({
    id: name,
    text: `${name} ${deps.bundleDescriptions[name] ?? ""}`,
  }));
  const keyword = bm25Rank(query, docs);
  const vector = deps.bundleOrder
    .map((name) => ({
      id: name,
      score: deps.embedder.cosine(
        queryEmbedding,
        catalog.embed(`${name} ${deps.bundleDescriptions[name] ?? ""}`),
      ),
    }))
    .sort((left, right) => right.score - left.score);
  return [...rrf([keyword, vector])]
    .sort((left, right) => right[1] - left[1])
    .slice(0, deps.maxBundles)
    .map(([id]) => id);
}

async function buildToolset({
  deps,
  catalog,
  metaTools,
  turn,
  bundles,
  safe,
}: {
  readonly deps: RouterDeps;
  readonly catalog: RouterCatalog;
  readonly metaTools: MetaTools;
  readonly turn: TurnCtx;
  readonly bundles: string[];
  readonly safe: boolean;
}): Promise<Toolset> {
  const entries = [...(await catalog.ensure()).values()];
  const core = entries
    .filter((entry) => entry.core && !(safe && deniedCore(entry)))
    .map((entry) => entry.def);
  const deferrable = entries.filter((entry) =>
    !entry.core && !(safe && entry.def.meta.write)
  );
  const engaged = disclosureEngaged({ deps, turn, deferrable });
  const exposed = exposeTools({
    core,
    deferrable,
    bundles,
    metaTools,
    engaged,
  });
  return materializeToolset(exposed, deps.bundleOrder, engaged);
}

function deniedCore(entry: CatalogEntry): boolean {
  return SAFE_CORE_DENY.has(entry.def.name);
}

function disclosureEngaged({
  deps,
  turn,
  deferrable,
}: {
  readonly deps: RouterDeps;
  readonly turn: TurnCtx;
  readonly deferrable: CatalogEntry[];
}): boolean {
  const coldTokens = deferrable.reduce(
    (total, entry) => total + (entry.def.meta.cold_tokens ?? 0),
    0,
  );
  const contextWindow = deps.contextWindowFor(turn);
  const cutoff = contextWindow > 0
    ? Math.floor(contextWindow * DISCLOSURE_CONTEXT_FRACTION)
    : deps.disclosureCutoffTokens;
  return coldTokens > cutoff;
}

function exposeTools({
  core,
  deferrable,
  bundles,
  metaTools,
  engaged,
}: {
  readonly core: ToolDef[];
  readonly deferrable: CatalogEntry[];
  readonly bundles: string[];
  readonly metaTools: MetaTools;
  readonly engaged: boolean;
}): ToolDef[] {
  if (!engaged) return [...core, ...deferrable.map((entry) => entry.def)];
  const selected = new Set(bundles);
  const inBundles = deferrable
    .filter((entry) => selected.has(entry.bundle))
    .map((entry) => entry.def);
  return [...core, ...inBundles, metaTools.search, metaTools.invoke];
}

function materializeToolset(
  exposed: ToolDef[],
  bundleOrder: string[],
  disclosureEngaged: boolean,
): Toolset {
  exposed.sort(byStableOrder(bundleOrder));
  const defs = new Map<string, ToolDef>();
  const tools: ToolSchema[] = [];
  for (const def of exposed) {
    if (defs.has(def.name)) continue;
    defs.set(def.name, def);
    tools.push({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    });
  }
  return { tools, defs, disclosureEngaged };
}

async function searchTools({
  deps,
  catalog,
  query,
  limit,
}: {
  readonly deps: RouterDeps;
  readonly catalog: RouterCatalog;
  readonly query: string;
  readonly limit: number;
}): Promise<SearchHit[]> {
  const entriesByName = await catalog.ensure();
  const { entries, index } = catalog.searchState();
  const queryEmbedding = catalog.embed(query);
  const keyword = rankBm25(query, index);
  const vector = entries
    .map(({ entry, embedding }) => ({
      id: entry.def.name,
      score: deps.embedder.cosine(queryEmbedding, embedding),
    }))
    .sort((left, right) => right.score - left.score);
  return [...rrf([keyword, vector])]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, score]) => ({
      name,
      description: entriesByName.get(name)!.def.description,
      score,
    }));
}

function byStableOrder(
  bundleOrder: string[],
): (left: ToolDef, right: ToolDef) => number {
  const ranks = new Map(bundleOrder.map((bundle, index) => [bundle, index]));
  const rank = (def: ToolDef): number => {
    if (def.meta.core) return -1;
    return ranks.get(def.meta.bundle) ?? UNKNOWN_BUNDLE_RANK;
  };
  return (left, right) => {
    const difference = rank(left) - rank(right);
    return difference === 0
      ? left.name.localeCompare(right.name)
      : difference;
  };
}
