import type { ExplorerEdge } from "../types/explorer";
import type { RawEdge, RawTopology } from "../types/topology";

import { DEFAULT_EDGE_MOTION, EDGE_MOTION } from "./pack-constants";
import { splitValues } from "./pack-nodes";

const MAX_WIRE_DATA = 6;
const MAX_CLASSIFICATIONS = 4;

const wireData = (edge: RawEdge): string[] =>
  splitValues(edge.carries ?? edge.contract?.payload ?? "").slice(
    0,
    MAX_WIRE_DATA,
  );

const classificationTags = (edge: RawEdge): string[] =>
  splitValues(edge.security)
    .filter((value) => /secret|pii|internal|metadata|content/i.test(value))
    .slice(0, MAX_CLASSIFICATIONS);

const consistencyLine = (edge: RawEdge): string =>
  [
    edge.contract?.delivery,
    edge.contract?.ordering,
    edge.contract?.idempotency,
  ]
    .filter(Boolean)
    .join(" · ");

export const buildEdge = (edge: RawEdge): ExplorerEdge => ({
  id: edge.id,
  from: edge.from,
  to: edge.to,
  kind: edge.kind ?? "data",
  mode: edge.contract?.direction ?? "",
  purpose: edge.label ?? "",
  protocol: edge.protocol ?? "",
  routeOrSubject: edge.routing ?? "",
  data: wireData(edge),
  dataClassifications: classificationTags(edge),
  consistency: consistencyLine(edge),
  failureHandling: edge.contract?.errorHandling ?? "",
  security: edge.security ?? edge.contract?.authz ?? "",
  confidence: "verified",
  motion: EDGE_MOTION[edge.kind ?? ""] ?? DEFAULT_EDGE_MOTION,
  evidence: edge.evidence ?? "",
  original: edge,
});

export const buildEdges = (raw: RawTopology): ExplorerEdge[] =>
  (raw.edges ?? []).map(buildEdge);
