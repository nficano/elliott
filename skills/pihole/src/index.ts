import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  PiholeSettings,
  ToolDefinition,
} from "../../../src/runtime/types";
import { detectBackend } from "./api";
import { dnsLocalFacility } from "./facility";
import { address, hostname, removeDomain } from "./records";
import type { PiholeBackend, PiholeBackendSource } from "./types";

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.pihole;
  if (settings === undefined) return {};
  const backend = backendSource(settings);
  return {
    tools: [listTool(backend), setTool(backend), removeTool(backend)],
    facilities: [dnsLocalFacility(backend)],
  };
};

// Backend detection (v5 api.php vs v6 REST) runs once on first use and is
// memoized; a detection failure clears the memo so the next call retries.
const backendSource = (settings: PiholeSettings): PiholeBackendSource => {
  let cached: Promise<PiholeBackend> | undefined;
  return () => {
    cached ??= detectBackend(settings).catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
    return cached;
  };
};

const listTool = (backend: PiholeBackendSource): ToolDefinition => ({
  name: "pihole_dns_list",
  description: "List the local DNS records Pi-hole serves for the LAN: "
    + "host (A/AAAA) entries and CNAME aliases.",
  inputSchema: objectSchema({}, []),
  execute: async () => JSON.stringify(await (await backend()).snapshot()),
});

const setTool = (backend: PiholeBackendSource): ToolDefinition => ({
  name: "pihole_dns_set",
  description: "Create or replace a local DNS record on Pi-hole. Provide ip "
    + "for an A/AAAA record or target for a CNAME alias (exactly one). Any "
    + "existing record for the domain is replaced. This changes name "
    + "resolution for every device on the LAN — explain the change first.",
  inputSchema: objectSchema({
    domain: { type: "string" },
    ip: { type: "string" },
    target: { type: "string" },
  }, ["domain"]),
  execute: async (input) => {
    const domain = hostname(requiredString(input, "domain"));
    const ip = optionalField(input, "ip");
    const target = optionalField(input, "target");
    if ((ip === undefined) === (target === undefined)) {
      throw new Error("Provide exactly one of ip or target");
    }
    const alias = target === undefined ? undefined : hostname(target);
    const api = await backend();
    await removeDomain(api, domain);
    await (ip === undefined
      ? api.addCname(domain, alias ?? "")
      : api.addHost(address(ip), domain));
    return JSON.stringify(await api.snapshot());
  },
});

const removeTool = (backend: PiholeBackendSource): ToolDefinition => ({
  name: "pihole_dns_remove",
  description: "Remove the local DNS records (host entries and CNAME "
    + "aliases) Pi-hole serves for a domain. The domain falls back to "
    + "upstream resolution for every device on the LAN.",
  inputSchema: objectSchema({ domain: { type: "string" } }, ["domain"]),
  execute: async (input) => {
    const domain = hostname(requiredString(input, "domain"));
    const api = await backend();
    const removed = await removeDomain(api, domain);
    return JSON.stringify({ removed, ...await api.snapshot() });
  },
});

const optionalField = (input: unknown, key: string): string | undefined => {
  if (!isJsonRecord(input)) return undefined;
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
