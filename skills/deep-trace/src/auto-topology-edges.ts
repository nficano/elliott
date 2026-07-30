import type { StoredGrant } from "../../../src/runtime/skills/types";
import type { AutoEdge, ManifestTopology } from "./types";

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// Same dispatch semantics as scripts/gen-topology.mjs uniformEdges — keep the
// two in step so build-time and runtime derivations never disagree.
export const uniformEdges = (
  nodeId: string,
  dispatch: string | undefined,
): readonly AutoEdge[] => {
  switch (dispatch) {
    case "socket": {
      return [{
        from: nodeId,
        to: "runtime.inbound",
        kind: "data",
        protocol: "in-process (GatewayEvents.onMessage)",
        label: "inbound -> turn",
      }];
    }
    case "route": {
      return [
        {
          from: "runtime.http",
          to: nodeId,
          kind: "control",
          protocol: "in-process (route dispatch)",
          label: "dispatch route",
        },
        {
          from: nodeId,
          to: "runtime.inbound",
          kind: "data",
          protocol: "in-process (GatewayEvents.onMessage)",
          label: "payload -> turn",
        },
      ];
    }
    case "tool": {
      return [{
        from: "runtime.toolExec",
        to: nodeId,
        kind: "data",
        protocol: "in-process (ToolDefinition.execute)",
        label: "execute",
      }];
    }
    default: {
      return []; // none | service — declared via edges
    }
  }
};

export const declaredEdges = (
  nodeId: string,
  topology: ManifestTopology,
): readonly AutoEdge[] =>
  topology.edges.flatMap((edge) => {
    const from = str(edge["from"]);
    const to = str(edge["to"]);
    const kind = str(edge["kind"]);
    if (from === undefined || to === undefined || kind === undefined) return [];
    return [{
      from: from === "self" ? nodeId : from,
      to: to === "self" ? nodeId : to,
      kind,
      protocol: str(edge["protocol"]) ?? "in-process",
      label: str(edge["label"]) ?? "",
    }];
  });

// consumer -> provider control edges from the persisted facility grants; both
// endpoints resolve through each package's declared topology node.
export const grantEdges = (
  grants: readonly StoredGrant[],
  nodeIdByPackage: ReadonlyMap<string, string>,
  providerByFacility: ReadonlyMap<string, string>,
): readonly AutoEdge[] =>
  grants.flatMap((grant) => {
    const from = nodeIdByPackage.get(grant.consumer);
    const provider = providerByFacility.get(grant.facilityId);
    const to = provider === undefined
      ? undefined
      : nodeIdByPackage.get(provider);
    if (from === undefined || to === undefined) return [];
    return [{
      from,
      to,
      kind: "control",
      protocol: "in-process (FacilityDirectory.acquire)",
      label: `facility ${grant.facilityId} (${grant.name})`,
    }];
  });

export const edgeKey = (edge: {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
}): string => `${edge.from}|${edge.to}|${edge.kind}`;

export const edgeId = (edge: AutoEdge): string =>
  `e.auto.${edge.from}--${edge.to}--${edge.kind}`
    .replaceAll(/[^\w.-]/g, "");
