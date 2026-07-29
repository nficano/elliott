import type {
  FacilityBinding,
  FacilityDescriptor,
  JsonRecord,
} from "../../../src/runtime/skills/types";
import { address, hostname, removeDomain } from "./records";
import type { DnsRecordConfig, PiholeBackendSource } from "./types";

export const DNS_FACILITY_ID = "dns.local";
export const DNS_FACILITY_VERSION = 1;

// The dns.local facility: another skill claims a LAN hostname during its own
// register() — an A/AAAA record or CNAME alias on the Pi-hole — instead of
// asking the operator to click it into the admin UI. Acquire replaces any
// existing record for the domain, so it is idempotent per domain; release
// removes the record and the domain falls back to upstream resolution.
export const dnsLocalFacility = (
  backend: PiholeBackendSource,
): FacilityBinding => ({
  id: DNS_FACILITY_ID,
  version: DNS_FACILITY_VERSION,
  describe: describeDnsLocal,
  acquire: async (request) => {
    const record = decodeRecord(request.config);
    const api = await backend();
    await removeDomain(api, record.domain);
    await (record.ip === undefined
      ? api.addCname(record.domain, record.target ?? "")
      : api.addHost(record.ip, record.domain));
    return {
      grantId: grantId(record.domain),
      facility: `${DNS_FACILITY_ID}@${DNS_FACILITY_VERSION}`,
      values: { ...record },
    };
  },
  release: async (id) => {
    await removeDomain(await backend(), domainFromGrantId(id));
  },
});

const decodeRecord = (config: JsonRecord): DnsRecordConfig => {
  const domain = hostname(String(config["domain"]));
  const ip = optional(config["ip"]);
  const target = optional(config["target"]);
  if ((ip === undefined) === (target === undefined)) {
    throw new Error("Provide exactly one of ip or target");
  }
  return {
    domain,
    ...(ip !== undefined && { ip: address(ip) }),
    ...(target !== undefined && { target: hostname(target) }),
  };
};

const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const grantId = (domain: string): string => `${DNS_FACILITY_ID}:${domain}`;

const domainFromGrantId = (id: string): string => {
  const prefix = `${DNS_FACILITY_ID}:`;
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(`Grant ${id} does not belong to ${DNS_FACILITY_ID}`);
  }
  return id.slice(prefix.length);
};

const describeDnsLocal = (): FacilityDescriptor => ({
  id: DNS_FACILITY_ID,
  version: DNS_FACILITY_VERSION,
  description: "A local DNS record on the LAN Pi-hole: an A/AAAA host entry "
    + "(ip) or CNAME alias (target) for the requested domain — exactly one of "
    + "the two. Existing records for the domain are replaced.",
  requestSchema: {
    type: "object",
    required: ["domain"],
    additionalProperties: false,
    properties: {
      domain: { type: "string" },
      ip: { type: "string" },
      target: { type: "string" },
    },
  },
  grantSchema: {
    type: "object",
    required: ["domain"],
    additionalProperties: false,
    properties: {
      domain: { type: "string" },
      ip: { type: "string" },
      target: { type: "string" },
    },
  },
});
