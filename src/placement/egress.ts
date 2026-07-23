import type {
  EgressClass,
  EgressClassName,
  EgressPolicySources,
  EgressRealization,
} from "./types";

const ORDER: readonly EgressClassName[] = [
  "none",
  "loopback",
  "lan",
  "declared",
  "any",
];

const normalizeHosts = (hosts: readonly string[]): readonly string[] =>
  Object.freeze(
    [...new Set(hosts)].sort((left, right) => left.localeCompare(right)),
  );

const intersectHosts = (
  left: readonly string[],
  right: readonly string[],
): readonly string[] => {
  const allowed = new Set(right);
  return normalizeHosts(left.filter((host) => allowed.has(host)));
};

export const egressClass = (
  kind: EgressClassName,
  hosts: readonly string[] = [],
): EgressClass => Object.freeze({ kind, hosts: normalizeHosts(hosts) });

export const intersectEgress = (
  left: EgressClass,
  right: EgressClass,
): EgressClass => {
  const leftRank = ORDER.indexOf(left.kind);
  const rightRank = ORDER.indexOf(right.kind);
  const kind = ORDER[Math.min(leftRank, rightRank)] ?? "none";
  if (kind !== "declared") return egressClass(kind);
  if (left.kind !== "declared") return egressClass(kind, right.hosts);
  if (right.kind !== "declared") return egressClass(kind, left.hosts);
  return egressClass(kind, intersectHosts(left.hosts, right.hosts));
};

export const resolveEgress = (sources: EgressPolicySources): EgressClass =>
  intersectEgress(
    intersectEgress(sources.manifest, sources.template),
    intersectEgress(sources.workspace, sources.organization),
  );

export const realizeEgress = (policy: EgressClass): EgressRealization => {
  if (policy.kind === "none") {
    return Object.freeze({
      policy,
      networkAttachment: "internal",
      packetDestinations: Object.freeze([]),
      brokerDestinations: Object.freeze([]),
    });
  }
  if (policy.kind === "loopback") {
    return Object.freeze({
      policy,
      networkAttachment: "none",
      packetDestinations: Object.freeze(["loopback"]),
      brokerDestinations: Object.freeze(["loopback"]),
    });
  }
  const destinations = policy.kind === "lan"
    ? Object.freeze(["rfc1918"])
    : policy.hosts;
  return Object.freeze({
    policy,
    networkAttachment: policy.kind === "lan" ? "host-bridge" : "filtered",
    packetDestinations: destinations,
    brokerDestinations: destinations,
  });
};

export const egressAllows = (
  policy: EgressClass,
  destination: string,
): boolean =>
  policy.kind === "any"
  || (policy.kind === "loopback" && destination === "loopback")
  || (policy.kind === "lan" && destination === "rfc1918")
  || (policy.kind === "declared" && policy.hosts.includes(destination));
