import { isJsonRecord } from "../../../src/providers/http";
import type {
  CloudflareApi,
  CloudflareCredentials,
  ReconcileContext,
  TunnelProvisionState,
} from "./types";

// A tunnel is identified by NAME, derived from the HOSTNAME it serves, so a
// restart adopts the tunnel it created last time instead of accumulating a new
// one per boot — and two agents in one account, serving different hostnames,
// never collide on a shared name. Non-label characters are collapsed so the
// name stays within what Cloudflare accepts.
export const tunnelNameFor = (hostname: string): string =>
  `elliott-${hostname.toLowerCase().replaceAll(/[^a-z0-9.-]/g, "-")}`;

const stringField = (value: unknown, key: string): string | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
};

const findTunnelId = async (
  api: CloudflareApi,
  credentials: CloudflareCredentials,
  name: string,
): Promise<string | undefined> => {
  // is_deleted=false: Cloudflare keeps deleted tunnels queryable, and adopting
  // one would produce a tunnel that can never connect.
  const found = await api.request(
    "GET",
    `/accounts/${credentials.accountId}/cfd_tunnel?name=${
      encodeURIComponent(name)
    }&is_deleted=false`,
  );
  if (!found.success || !Array.isArray(found.result)) return undefined;
  for (const entry of found.result) {
    const id = stringField(entry, "id");
    if (id !== undefined) return id;
  }
  return undefined;
};

// Ensure the named tunnel exists, returning its id. Creating is the exception:
// on every boot after the first this is a single GET that finds what is already
// there and changes nothing.
const ensureTunnel = async (
  ctx: ReconcileContext,
  name: string,
): Promise<string | undefined> => {
  const { api, credentials, changes } = ctx;
  const existing = await findTunnelId(api, credentials, name);
  if (existing !== undefined) return existing;
  const created = await api.request(
    "POST",
    `/accounts/${credentials.accountId}/cfd_tunnel`,
    { name, config_src: "cloudflare" },
  );
  if (!created.success) return undefined;
  const id = stringField(created.result, "id");
  if (id !== undefined) changes.push(`created tunnel ${name}`);
  return id;
};

// Pin ingress to the loopback service and nothing else. This is the rule that
// keeps a provisioned tunnel from becoming a general-purpose ingress into the
// host: whatever hostname is routed, it terminates at this runtime's own port.
// The catch-all 404 is required by cloudflared — a config whose last rule has a
// hostname is rejected.
const ensureIngress = async (
  ctx: ReconcileContext,
  input: { tunnelId: string; hostname: string; servicePort: number; },
): Promise<boolean> => {
  const { api, credentials, changes } = ctx;
  const service = `http://localhost:${input.servicePort}`;
  const desired = {
    config: {
      ingress: [
        { hostname: input.hostname, service },
        { service: "http_status:404" },
      ],
    },
  };
  const current = await api.request(
    "GET",
    `/accounts/${credentials.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
  );
  if (
    current.success && matchesIngress(current.result, input.hostname, service)
  ) {
    return true;
  }
  const applied = await api.request(
    "PUT",
    `/accounts/${credentials.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
    desired,
  );
  if (applied.success) changes.push(`routed ${input.hostname} to ${service}`);
  return applied.success;
};

const matchesIngress = (
  result: unknown,
  hostname: string,
  service: string,
): boolean => {
  if (!isJsonRecord(result)) return false;
  const config = result["config"];
  if (!isJsonRecord(config)) return false;
  const ingress = config["ingress"];
  if (!Array.isArray(ingress)) return false;
  return ingress.some((rule) =>
    stringField(rule, "hostname") === hostname
    && stringField(rule, "service") === service
  );
};

// The CNAME that makes the hostname resolve to the tunnel. Proxied is not
// optional: an unproxied record would expose the tunnel target directly.
const ensureDnsRecord = async (
  ctx: ReconcileContext,
  input: { tunnelId: string; hostname: string; },
): Promise<boolean> => {
  const { api, credentials, changes } = ctx;
  const content = `${input.tunnelId}.cfargotunnel.com`;
  const existing = await api.request(
    "GET",
    `/zones/${credentials.zoneId}/dns_records?type=CNAME&name=${
      encodeURIComponent(input.hostname)
    }`,
  );
  const record: unknown = existing.success && Array.isArray(existing.result)
    ? (existing.result as readonly unknown[])[0]
    : undefined;
  const recordId = stringField(record, "id");
  const desired = {
    type: "CNAME",
    name: input.hostname,
    content,
    proxied: true,
    comment: "managed by elliott",
  };
  if (recordId === undefined) {
    const created = await api.request(
      "POST",
      `/zones/${credentials.zoneId}/dns_records`,
      desired,
    );
    if (created.success) changes.push(`created DNS ${input.hostname}`);
    return created.success;
  }
  // Heal drift: a record pointing at a stale tunnel id resolves to nothing.
  if (stringField(record, "content") === content) return true;
  const updated = await api.request(
    "PUT",
    `/zones/${credentials.zoneId}/dns_records/${recordId}`,
    desired,
  );
  if (updated.success) changes.push(`repointed DNS ${input.hostname}`);
  return updated.success;
};

// The connector token the sidecar needs to run this tunnel. Fetched fresh every
// boot rather than persisted, so the only credential at rest is the API token
// the operator already manages.
export const fetchConnectorToken = async (
  api: CloudflareApi,
  credentials: CloudflareCredentials,
  tunnelId: string,
): Promise<string | undefined> => {
  const token = await api.request(
    "GET",
    `/accounts/${credentials.accountId}/cfd_tunnel/${tunnelId}/token`,
  );
  return token.success && typeof token.result === "string"
    ? token.result
    : undefined;
};

// One idempotent pass: adopt-or-create the tunnel, pin its ingress, point DNS
// at it. Returns undefined with a derived reason on the first failure rather
// than continuing against a half-built tunnel.
export const reconcileTunnel = async (
  api: CloudflareApi,
  credentials: CloudflareCredentials,
  input: { hostname: string; servicePort: number; },
): Promise<TunnelProvisionState | undefined> => {
  const changes: string[] = [];
  const ctx: ReconcileContext = { api, credentials, changes };
  const name = tunnelNameFor(input.hostname);
  const tunnelId = await ensureTunnel(ctx, name);
  if (tunnelId === undefined) return undefined;
  const routed = await ensureIngress(ctx, {
    tunnelId,
    hostname: input.hostname,
    servicePort: input.servicePort,
  });
  if (!routed) return undefined;
  const resolved = await ensureDnsRecord(ctx, {
    tunnelId,
    hostname: input.hostname,
  });
  if (!resolved) return undefined;
  return {
    tunnelId,
    hostname: input.hostname,
    publicBaseUrl: `https://${input.hostname}`,
    changes,
  };
};
