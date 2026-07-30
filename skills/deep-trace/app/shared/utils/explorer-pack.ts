import type { ExplorerPack, HostZone, PackMeta } from "../types/explorer";
import type { RawTopology } from "../types/topology";

import {
  ACTIVE_PACK_ID,
  DOMAIN_PALETTE,
  EDGE_KIND_STYLES,
  HOST_BASE_COLOR,
  HOSTS,
  LAYERS,
} from "./pack-constants";
import { buildEdges } from "./pack-edges";
import { buildFlows } from "./pack-flows";
import { buildNodes } from "./pack-nodes";
import { CANVAS_COLOR, HOST_COLOR } from "./palette";

const buildMeta = (raw: RawTopology): PackMeta => ({
  id: ACTIVE_PACK_ID,
  title: raw.title ?? "Elliott Runtime — Verified Connection Graph",
  label: "Elliott runtime",
  revision: raw.version ?? "verified",
  evidenceDate: "verified runtime + bundled skills",
  summary: raw.note ?? "",
  philosophy:
    "Show verified runtime connections, inactive seams, trust boundaries, and failure behavior without flattening them into a generic service diagram.",
  assumptions: Object.entries(raw.runtimeLegend ?? {}).map(
    ([state, meaning]) => `${state}: ${meaning}`,
  ),
  decisions: (raw.domains ?? []).map(
    (domain) => `${domain.title}: ${domain.purpose}`,
  ),
  qualityAttributes: raw.classificationSchemes ?? {},
  limitations: raw.enrichmentNotes ?? [],
});

const buildHosts = (): HostZone[] =>
  HOSTS.map((host) => ({
    ...host,
    color: HOST_COLOR[host.id] ?? HOST_BASE_COLOR[host.id]
      ?? CANVAS_COLOR.boardNeutral,
  }));

// Build the full explorer view model from the raw verified topology. The
// output matches what the legacy inline script exposed as
// window.ELLIOTT_EXPLORER_DATA.
export const buildExplorerPack = (raw: RawTopology): ExplorerPack => {
  const edges = buildEdges(raw);
  return {
    meta: buildMeta(raw),
    nodes: buildNodes(raw),
    edges,
    flows: buildFlows(edges),
    hosts: buildHosts(),
    layers: LAYERS,
    domains: raw.domains ?? [],
    rendering: {
      domainPalette: DOMAIN_PALETTE,
      edgeKindStyles: EDGE_KIND_STYLES,
    },
  };
};
