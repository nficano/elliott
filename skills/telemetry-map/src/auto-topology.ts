import { isJsonRecord } from "../../../src/providers/http";
import type {
  JsonRecord,
  SkillPackageView,
} from "../../../src/runtime/skills/types";
import {
  declaredEdges,
  edgeId,
  edgeKey,
  grantEdges,
  uniformEdges,
} from "./auto-topology-edges";
import type {
  AutoEdge,
  Candidate,
  ManifestTopology,
  MergeInput,
  MergeState,
  ParsedDocument,
} from "./types";

export type { MergeInput } from "./types";

// Runtime counterpart of scripts/gen-topology.mjs: every loaded package that
// declares a manifest spec.topology block auto-registers on the served map.
// The hand-enriched base document stays authoritative for the nodes it
// already describes — an auto node is only added when its id is absent — but
// two things always come from the live runtime, because only it knows them:
// `runtime` liveness (did register() actually produce bindings?) and facility
// grant edges (which consumer acquired what from which provider).

const JSON_INDENT = 2;

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const decodeTopology = (
  value: JsonRecord | undefined,
): ManifestTopology | undefined => {
  if (value === undefined) return undefined;
  const node = value["node"];
  if (!isJsonRecord(node)) return undefined;
  const nodeId = str(node["id"]);
  if (nodeId === undefined) return undefined;
  const edges = Array.isArray(value["edges"])
    ? value["edges"].filter(isJsonRecord)
    : [];
  const dispatch = str(value["dispatch"]);
  return {
    node,
    nodeId,
    ...(dispatch !== undefined && { dispatch }),
    edges,
    egressTargets: strings(value["egressTargets"]),
  };
};

const totalBindings = (view: SkillPackageView): number =>
  Object.values(view.bindings).reduce((sum, count) => sum + count, 0);

// live only when register() succeeded and produced at least one binding; the
// dominant production cause for anything else is a missing secret or a
// disabled flag, which is exactly what the config-gated legend entry means.
const resolveLiveness = (view: SkillPackageView): string =>
  view.registered && totalBindings(view) > 0 ? "live" : "config-gated";

// Repo-relative source for display — the map is published, so the absolute
// host path must never leak into the document.
const sourcePath = (view: SkillPackageView): string => {
  const agents = view.directory.lastIndexOf("/agents/");
  if (agents !== -1) return view.directory.slice(agents + 1);
  const skills = view.directory.lastIndexOf("/skills/");
  if (skills !== -1) return view.directory.slice(skills + 1);
  return `skills/${view.name}`;
};

const buildNode = (candidate: Candidate, runtime: string): JsonRecord => {
  const { view, topology } = candidate;
  const source = sourcePath(view);
  const node = topology.node;
  const classifications = {
    ...(str(node["trustZone"]) !== undefined
      && { trustZone: node["trustZone"] }),
    ...(str(node["dataClassification"]) !== undefined
      && { dataClassification: node["dataClassification"] }),
    ...(str(node["criticality"]) !== undefined
      && { criticality: node["criticality"] }),
  };
  return {
    id: topology.nodeId,
    name: `${view.name} (${source})`,
    kind: str(node["kind"]) ?? view.kind,
    runtime,
    domain: str(node["domain"]) ?? "runtime",
    source,
    ...(Object.keys(classifications).length > 0 && { classifications }),
    ...(topology.egressTargets.length > 0
      && { egressTargets: topology.egressTargets }),
  };
};

const parseDocument = (base: string): ParsedDocument | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base);
  } catch {
    return undefined;
  }
  if (!isJsonRecord(parsed)) return undefined;
  const list = (value: unknown): readonly unknown[] =>
    Array.isArray(value) ? value : [];
  return {
    raw: parsed,
    nodes: list(parsed["nodes"]),
    edges: list(parsed["edges"]),
    domains: list(parsed["domains"]),
  };
};

const idOf = (value: unknown): string | undefined =>
  isJsonRecord(value) ? str(value["id"]) : undefined;

// Liveness per node id across all declaring packages: when two packages map
// onto one merged node (e.g. both search skills behind tool.search), a single
// live registration is enough for the node to read as live.
const resolvedLiveness = (
  candidates: readonly Candidate[],
): ReadonlyMap<string, string> => {
  const liveness = new Map<string, string>();
  for (const candidate of candidates) {
    const previous = liveness.get(candidate.topology.nodeId);
    if (previous === "live") continue;
    liveness.set(candidate.topology.nodeId, resolveLiveness(candidate.view));
  }
  return liveness;
};

// Overrides `runtime` on base nodes whose actual liveness differs from what
// the static document claims, without touching any other field.
const applyLiveness = (
  state: MergeState,
  liveness: ReadonlyMap<string, string>,
): void => {
  for (const [index, node] of state.nodesOut.entries()) {
    const id = idOf(node);
    if (id === undefined) continue;
    const runtime = liveness.get(id);
    if (runtime === undefined) continue;
    const current = str((node as JsonRecord)["runtime"]);
    if (current === runtime) continue;
    state.nodesOut[index] = { ...(node as JsonRecord), runtime };
    state.summary.liveness[id] = runtime;
  }
};

const addNodes = (
  state: MergeState,
  candidates: readonly Candidate[],
  liveness: ReadonlyMap<string, string>,
): readonly AutoEdge[] => {
  const pending: AutoEdge[] = [];
  for (const candidate of candidates) {
    const { nodeId } = candidate.topology;
    if (state.nodeIds.has(nodeId)) continue;
    const runtime = liveness.get(nodeId) ?? "config-gated";
    state.nodesOut.push(buildNode(candidate, runtime));
    state.nodeIds.add(nodeId);
    state.summary.nodes.push(nodeId);
    pending.push(
      ...uniformEdges(nodeId, candidate.topology.dispatch),
      ...declaredEdges(nodeId, candidate.topology),
    );
  }
  return pending;
};

const addEdges = (state: MergeState, pending: readonly AutoEdge[]): void => {
  const keys = new Set(
    state.edgesOut.flatMap((edge) =>
      isJsonRecord(edge)
        && str(edge["from"]) !== undefined
        && str(edge["to"]) !== undefined
        && str(edge["kind"]) !== undefined
        ? [edgeKey(edge as { from: string; to: string; kind: string; })]
        : []
    ),
  );
  const ids = new Set(state.edgesOut.map(idOf));
  for (const edge of pending) {
    // A dangling endpoint means the referenced component is not on this map;
    // dropping matches gen-topology's validation rather than breaking the UI.
    if (!state.nodeIds.has(edge.from) || !state.nodeIds.has(edge.to)) continue;
    const key = edgeKey(edge);
    if (keys.has(key)) continue;
    keys.add(key);
    const id = edgeId(edge);
    if (ids.has(id)) continue;
    ids.add(id);
    state.edgesOut.push({ id, ...edge });
    state.summary.edges.push(id);
  }
};

const addMissingDomains = (
  state: MergeState,
  domains: readonly unknown[],
): readonly unknown[] => {
  const known = new Set(domains.map(idOf));
  const out = [...domains];
  for (const nodeId of state.summary.nodes) {
    const node = state.nodesOut.find((item) => idOf(item) === nodeId);
    const domain = isJsonRecord(node) ? str(node["domain"]) : undefined;
    if (domain === undefined || known.has(domain)) continue;
    known.add(domain);
    out.push({
      id: domain,
      title: (domain[0] ?? "").toUpperCase() + domain.slice(1),
    });
  }
  return out;
};

// Merge auto-registered skill nodes, resolved liveness, and facility grant
// edges into the base document. Returns the base string verbatim when there
// is nothing to change, so a bare context serves the enriched file untouched.
export const mergeTopology = (input: MergeInput): string => {
  const document = parseDocument(input.base);
  if (document === undefined) return input.base;
  const candidates = input.packages.flatMap((view) => {
    const topology = decodeTopology(view.topology);
    return topology === undefined ? [] : [{ view, topology }];
  });
  const state: MergeState = {
    nodesOut: [...document.nodes],
    edgesOut: [...document.edges],
    nodeIds: new Set(
      document.nodes.map(idOf).filter((id): id is string => id !== undefined),
    ),
    summary: { nodes: [], edges: [], liveness: {} },
  };
  const liveness = resolvedLiveness(candidates);
  applyLiveness(state, liveness);
  const pending = [
    ...addNodes(state, candidates, liveness),
    ...grantEdges(
      input.grants,
      new Map(candidates.map((c) => [c.view.name, c.topology.nodeId])),
      new Map(
        input.packages.flatMap((view) =>
          view.provides.map((facility) => [facility, view.name] as const)
        ),
      ),
    ),
  ];
  addEdges(state, pending);
  const { summary } = state;
  const changed = summary.nodes.length > 0
    || summary.edges.length > 0
    || Object.keys(summary.liveness).length > 0;
  if (!changed) return input.base;
  return JSON.stringify(
    {
      ...document.raw,
      domains: addMissingDomains(state, document.domains),
      nodes: state.nodesOut,
      edges: state.edgesOut,
      autoRegistration: summary,
    },
    undefined,
    JSON_INDENT,
  );
};
