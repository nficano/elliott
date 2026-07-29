#!/usr/bin/env bun
// Generate docs/elliott-topology.json from declarative sources:
//   - docs/topology.spine.json          (non-skill nodes + fixed runtime/cross-cutting edges)
//   - skills/**/manifest.yaml           (each module's spec.topology block -> its node + edges)
//   - agents/elliott.yaml                (mcp[] -> mcp endpoint nodes + client edges)
//   - config/elliott.yaml                (resolves config: gates to live/config-gated)
//
// Usage:
//   bun scripts/gen-topology.mjs           # write docs/elliott-topology.generated.json
//   bun scripts/gen-topology.mjs --check   # generate in-memory, diff vs docs/elliott-topology.json, exit 1 on structural drift
//   bun scripts/gen-topology.mjs --write   # overwrite docs/elliott-topology.json
//
// Runtime counterpart: skills/telemetry-map/src/auto-topology.ts derives the
// same node/uniform-edge shapes from loaded packages when serving /topology —
// keep the dispatch->edge semantics here and there in step.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_KINDS = new Set([
  "secret-source",
  "gateway",
  "runtime",
  "agent-loop",
  "provider",
  "tool",
  "service",
  "mcp-endpoint",
  "memory",
  "database",
  "learning",
  "evaluator",
  "extension",
  "observability",
  "container",
]);
const EDGE_KINDS = new Set([
  "data",
  "control",
  "persist",
  "learn",
  "health",
  "secret",
]);

const readJson = async (p) =>
  JSON.parse(await readFile(path.join(ROOT, p), "utf8"));
const readYaml = async (p) => parse(await readFile(path.join(ROOT, p), "utf8"));
const dget = (obj, dotted) =>
  dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const resolveRuntime = (gate, config) => {
  if (!gate || gate === "always") return "live";
  if (gate.startsWith("config:")) {
    const v = dget(config, gate.slice("config:".length));
    return v === true || (v != null && v !== false) ? "live" : "config-gated";
  }
  return "config-gated"; // secret:* — presence is only knowable at runtime
};

const edgeKey = (e) => `${e.from}|${e.to}|${e.kind}`;

const uniformEdges = (node, dispatch) => {
  switch (dispatch) {
    case "socket":
      return [{
        from: node.id,
        to: "runtime.inbound",
        kind: "data",
        protocol: "in-process (GatewayEvents.onMessage)",
        label: "inbound -> turn",
      }];
    case "route":
      return [
        {
          from: "runtime.http",
          to: node.id,
          kind: "control",
          protocol: "in-process (route dispatch)",
          label: "dispatch route",
        },
        {
          from: node.id,
          to: "runtime.inbound",
          kind: "data",
          protocol: "in-process (GatewayEvents.onMessage)",
          label: "payload -> turn",
        },
      ];
    case "tool":
      return [{
        from: "runtime.toolExec",
        to: node.id,
        kind: "data",
        protocol: "in-process (ToolDefinition.execute)",
        label: "execute",
      }];
    default:
      return []; // none | service — declare via edges
  }
};

const mcpNodeId = (id) => "mcp." + id.replace(/-/g, "");
const mcpProtocol = (t) =>
  t === "sse" ? "jsonrpc over sse" : "jsonrpc over streamable-http";

const discoverSkillDirectories = async (relative = "skills") => {
  const entries = await readdir(path.join(ROOT, relative), {
    withFileTypes: true,
  });
  if (
    entries.some((entry) => entry.isFile() && entry.name === "manifest.yaml")
  ) {
    return [relative];
  }
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => discoverSkillDirectories(`${relative}/${entry.name}`)),
  );
  return nested.flat().sort();
};

async function build() {
  const spine = await readJson("docs/topology.spine.json");
  const config = await readYaml("config/elliott.yaml");
  const agent = await readYaml("agents/elliott.yaml");

  const nodes = [...spine.nodes];
  const edges = spine.edges.map((e) => ({ ...e, origin: "spine" }));
  const skillDirs = await discoverSkillDirectories();

  let contributing = 0;
  for (const dir of skillDirs) {
    let manifest;
    try {
      manifest = await readYaml(`${dir}/manifest.yaml`);
    } catch {
      continue;
    }
    const topo = manifest?.spec?.topology;
    if (!topo?.node) continue;
    contributing++;
    const entry = manifest.spec.exports?.[0]?.implementation ?? "";
    const n = topo.node;
    nodes.push({
      id: n.id,
      name: `${manifest.metadata.name} (${entry ? dir + "/" + entry : dir})`,
      kind: n.kind,
      runtime: resolveRuntime(topo.gate, config),
      domain: n.domain,
      source: dir + (entry ? `/${entry}` : ""),
      classifications: {
        ...(n.trustZone && { trustZone: n.trustZone }),
        ...(n.dataClassification
          && { dataClassification: n.dataClassification }),
        ...(n.criticality && { criticality: n.criticality }),
      },
      ...(topo.egressTargets?.length && { egressTargets: topo.egressTargets }),
    });
    for (const e of uniformEdges(n, topo.dispatch)) {
      edges.push({ ...e, origin: `skill:${manifest.metadata.name}` });
    }
    for (const e of topo.edges ?? []) {
      edges.push({
        from: e.from === "self" ? n.id : e.from,
        to: e.to === "self" ? n.id : e.to,
        kind: e.kind,
        protocol: e.protocol ?? "in-process",
        label: e.label ?? "",
        origin: `skill:${manifest.metadata.name}`,
      });
    }
  }

  // MCP endpoints from the agent manifest
  for (const m of agent?.spec?.mcp ?? agent?.mcp ?? []) {
    const id = mcpNodeId(m.id);
    nodes.push({
      id,
      name: `${m.id} MCP server`,
      kind: "mcp-endpoint",
      runtime: "live",
      domain: "mcp-federation",
      source: "agents/elliott.yaml (mcp[])",
      ...(m.url && { egressTargets: [m.url] }),
    });
    edges.push({
      from: "mcp.client",
      to: id,
      kind: "data",
      protocol: mcpProtocol(m.transport),
      label: "tools/call",
      origin: "agent-mcp",
    });
  }

  // Assign deterministic ids + dedup edges (first origin wins)
  const seen = new Map();
  const outEdges = [];
  for (const e of edges) {
    const k = edgeKey(e);
    if (seen.has(k)) continue;
    seen.set(k, true);
    outEdges.push({
      id: e.id ?? `e.gen.${e.from}--${e.to}`.replace(/[^a-zA-Z0-9._-]/g, ""),
      ...e,
    });
  }
  return { nodes, edges: outEdges };
}

function validate({ nodes, edges }) {
  const errors = [];
  const ids = new Set();
  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!NODE_KINDS.has(n.kind)) errors.push(`node ${n.id} bad kind ${n.kind}`);
    if (!n.domain) errors.push(`node ${n.id} missing domain`);
  }
  const eids = new Set();
  for (const e of edges) {
    if (eids.has(e.id)) errors.push(`duplicate edge id ${e.id}`);
    eids.add(e.id);
    if (!EDGE_KINDS.has(e.kind)) errors.push(`edge ${e.id} bad kind ${e.kind}`);
    if (!ids.has(e.from)) errors.push(`edge ${e.id} dangling from=${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id} dangling to=${e.to}`);
  }
  return errors;
}

function diff(generated, baseline) {
  const gN = new Set(generated.nodes.map((n) => n.id));
  const bN = new Set(baseline.nodes.map((n) => n.id));
  const gE = new Set(generated.edges.map(edgeKey));
  const bE = new Set(baseline.edges.map(edgeKey));
  const only = (a, b) => [...a].filter((x) => !b.has(x));
  return {
    nodesAdded: only(gN, bN),
    nodesRemoved: only(bN, gN),
    edgesAdded: only(gE, bE),
    edgesRemoved: only(bE, gE),
  };
}

const args = new Set(process.argv.slice(2));
const graph = await build();
const errors = validate(graph);
const out = {
  version: "1.2.0-generated",
  title: "Elliott Runtime — Connection Graph (generated)",
  generatedFrom:
    "scripts/gen-topology.mjs: docs/topology.spine.json + skills/**/manifest.yaml spec.topology + agents/elliott.yaml mcp[] + config/elliott.yaml gates",
  note:
    "Auto-generated structural connection graph. Nodes/uniform-edges derive from each module's manifest; the runtime spine is hand-authored. `runtime` here is a static approximation (secret-gated => config-gated); the live telemetry-map extension resolves actual liveness.",
  nodeKinds: [...NODE_KINDS],
  edgeKinds: [...EDGE_KINDS],
  nodes: graph.nodes.map(({ ...n }) => n),
  edges: graph.edges.map(({ origin, ...e }) => e),
};

if (errors.length) {
  console.error("VALIDATION ERRORS:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log(
  `generated: ${graph.nodes.length} nodes, ${graph.edges.length} edges — valid`,
);

// Informational reconciliation vs the curated reference (never fails; the
// generator is one-node-per-skill so search/evaluator merges appear as splits).
try {
  const ref = await readJson("docs/elliott-topology.json");
  const d = diff(graph, ref);
  console.log(
    "\n=== reconciliation vs docs/elliott-topology.json (curated reference) ===",
  );
  console.log("nodes only in generated :", d.nodesAdded.join(", ") || "none");
  console.log("nodes only in reference :", d.nodesRemoved.join(", ") || "none");
  console.log(
    "edges only in generated :",
    d.edgesAdded.length,
    "| edges only in reference :",
    d.edgesRemoved.length,
  );
} catch {}

const fingerprint = (g) => JSON.stringify({ nodes: g.nodes, edges: g.edges });

if (args.has("--check")) {
  // CI drift guard: regenerate and compare against the committed generated file.
  let committed = null;
  try {
    committed = await readJson("docs/elliott-topology.generated.json");
  } catch {}
  if (!committed || fingerprint(committed) !== fingerprint(out)) {
    console.error(
      "\n--check: docs/elliott-topology.generated.json is stale or missing — run `bun scripts/gen-topology.mjs` and commit.",
    );
    process.exit(1);
  }
  console.log("\n--check: generated file is up to date.");
  process.exit(0);
}

const target = args.has("--write")
  ? "docs/elliott-topology.json"
  : "docs/elliott-topology.generated.json";
await writeFile(path.join(ROOT, target), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote ${target}`);
