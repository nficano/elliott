import type {
  ExplorerNode,
  NodeRenderState,
  SourceRef,
} from "../types/explorer";
import type { RawDomain, RawNode, RawTopology } from "../types/topology";

import { LAYER_BY_DOMAIN, NODE_LABELS } from "./pack-constants";

const MAX_LABEL_LENGTH = 20;

// Narrowing filter for optional-string lists (keeps non-empty strings).
export const presentStrings = (
  values: readonly (string | false | undefined)[],
): string[] =>
  values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
const BIRTH_STAGGER_SECONDS = 0.012;

export const splitValues = (value: unknown): string[] =>
  String(value || "")
    .split(/\s*[/;,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

// Compact a topology node name for the tile label: drop em-dash qualifiers,
// parentheticals, and the word "container"; capitalize; ellipsize past 20.
export const compactName = (value: unknown, id: string): string => {
  const label = NODE_LABELS[id];
  if (label !== undefined) return label;
  let s = String(value || "Unnamed component");
  s = s.split(/\s+[—–]\s+/)[0] ?? s;
  s = s.replaceAll(/\s*\([^)]*\)/g, "");
  s = s.replaceAll(/\bcontainer\b\s*/gi, "").trimEnd();
  s = s.trim();
  if (s) s = (s[0] ?? "").toUpperCase() + s.slice(1);
  if (s.length > MAX_LABEL_LENGTH) {
    return `${s.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
  }
  return s || "Unnamed";
};

export const runtimeTone = (
  state: string | undefined,
): "active" | "migration" | "inactive" =>
  state === "live" ? "active" : (state === "config-gated" ? "migration" : "inactive");

const sourceRefs = (node: RawNode): SourceRef[] =>
  String(node.source ?? "")
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((path) => ({ path, purpose: "Verified topology evidence" }));

const freshRenderState = (index: number): NodeRenderState => ({
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  ty: 0,
  tz: 0,
  sx: 0,
  sy: 0,
  depth: 0,
  r: 10,
  alpha: 1,
  birth: index * BIRTH_STAGGER_SECONDS,
  visible: true,
  paintAlpha: 0,
});

const securityLines = (node: RawNode): string[] => {
  const classifications = node.classifications ?? {};
  return presentStrings([
    classifications.dataClassification
    && `Data: ${classifications.dataClassification}`,
    classifications.trustZone && `Trust: ${classifications.trustZone}`,
  ]);
};

const dataOwnership = (node: RawNode): string[] => [
  ...(node.tables ?? []),
  ...(node.tablesWrittenAtRuntime ?? []).map(
    (table) => `runtime write: ${table}`,
  ),
];

const observabilityLines = (node: RawNode): string[] =>
  (node.characteristics ?? []).filter((item) =>
    /telemetry|observ|health|audit/i.test(item),
  );

export const buildNode = (
  node: RawNode,
  index: number,
  context: {
    readonly domainsById: ReadonlyMap<string, RawDomain>;
    readonly degree: ReadonlyMap<string, number>;
  },
): ExplorerNode => {
  const classifications = node.classifications ?? {};
  const domain = context.domainsById.get(node.domain ?? "");
  return {
    id: node.id,
    name: compactName(node.name, node.id),
    fullName: node.name ?? "",
    kind: node.kind ?? "",
    domain: node.domain ?? "runtime",
    host: classifications.trustZone ?? "trusted-core",
    runtimeState: node.runtime ?? "unknown",
    responsibility: node.characteristics?.[0] ?? node.interface ?? node.name
      ?? "",
    capabilities: presentStrings([
      node.kind,
      node.runtime,
      classifications.criticality,
    ]),
    hover: {
      summary: node.name ?? node.interface ?? "",
      badges: presentStrings([
        node.runtime,
        classifications.criticality,
        classifications.trustZone,
      ]),
    },
    authority: classifications.trustZone ?? "—",
    authorityDetail: domain?.trustBoundary ?? "",
    confidence: classifications.criticality ?? "verified",
    dataClassifications: splitValues(classifications.dataClassification),
    scaling: classifications.scalability ?? "",
    security: securityLines(node),
    operability: classifications.failureMode ?? domain?.failureIsolation ?? "",
    designRationale: node.characteristics?.[1] ?? "",
    detail: {
      interfaces: node.interface ?? "",
      dataOwnership: dataOwnership(node),
      failureModes: classifications.failureMode ?? "",
      observability: observabilityLines(node),
    },
    runtime: {
      models: node.models ?? [],
      languages: [],
      regions: [],
      lifecycle: runtimeTone(node.runtime),
      state: node.runtime ?? "unknown",
    },
    sourceRefs: sourceRefs(node),
    characteristics: node.characteristics ?? [],
    visual: {
      size: "m",
      layer: LAYER_BY_DOMAIN[node.domain ?? ""] ?? "layer:core",
      cluster: node.kind ?? "component",
      order: index,
      shapeClass: node.kind === "database" ? "database" : "system",
    },
    original: node,
    rs: freshRenderState(index),
  };
};

export const buildNodes = (raw: RawTopology): ExplorerNode[] => {
  const domainsById = new Map(
    (raw.domains ?? []).map((domain) => [domain.id, domain]),
  );
  const degree = new Map<string, number>();
  for (const edge of raw.edges ?? []) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  return (raw.nodes ?? []).map((node, index) =>
    buildNode(node, index, { domainsById, degree }),
  );
};
