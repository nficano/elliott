import type {
  FacilityBinding,
  FacilityDescriptor,
  JsonRecord,
} from "../../../src/runtime/skills/types";
import type { TraefikSettings } from "../../../src/runtime/types";
import type { RouteStore } from "./types";
import { hostnameValue, routeName, serviceTarget } from "./validate";

export const PROXY_FACILITY_ID = "proxy.route";
export const PROXY_FACILITY_VERSION = 1;

// The proxy.route facility: another skill publishes an HTTPS route on the
// LAN reverse proxy during its own register(). The route lands in the same
// managed table the traefik_route_* tools use, and Traefik picks it up on its
// next dynamic-config poll, issuing the certificate through the configured
// ACME resolver. The grant surfaces the proxy's LAN address (when configured)
// so the consumer can chain a dns.local record pointing the hostname at the
// proxy.
export const proxyRouteFacility = (
  settings: TraefikSettings,
  store: RouteStore,
): FacilityBinding => ({
  id: PROXY_FACILITY_ID,
  version: PROXY_FACILITY_VERSION,
  describe: () => describeProxyRoute(settings),
  acquire: async (request) => {
    const name = routeName(`${request.consumer}-${request.name}`);
    const route = decodeRoute(request.config);
    const table = await store.read();
    await store.write({ ...table, [name]: route });
    return {
      grantId: grantId(name),
      facility: `${PROXY_FACILITY_ID}@${PROXY_FACILITY_VERSION}`,
      values: {
        hostname: route.hostname,
        url: `https://${route.hostname}`,
        ...(settings.lanAddress !== undefined
          && { lanAddress: settings.lanAddress }),
      },
    };
  },
  release: async (id) => {
    const name = nameFromGrantId(id);
    const table = await store.read();
    if (table[name] === undefined) {
      throw new Error(`No managed route for grant ${id}`);
    }
    await store.write(
      Object.fromEntries(
        Object.entries(table).filter(([key]) => key !== name),
      ),
    );
  },
});

const decodeRoute = (
  config: JsonRecord,
): { readonly hostname: string; readonly serviceUrl: string; } => ({
  hostname: hostnameValue(String(config["hostname"])),
  serviceUrl: serviceTarget(String(config["serviceUrl"])),
});

const grantId = (name: string): string => `${PROXY_FACILITY_ID}:${name}`;

const nameFromGrantId = (id: string): string => {
  const prefix = `${PROXY_FACILITY_ID}:`;
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(`Grant ${id} does not belong to ${PROXY_FACILITY_ID}`);
  }
  return id.slice(prefix.length);
};

const describeProxyRoute = (settings: TraefikSettings): FacilityDescriptor => ({
  id: PROXY_FACILITY_ID,
  version: PROXY_FACILITY_VERSION,
  description: "An HTTPS route on the LAN reverse proxy: Traefik serves "
    + "https://<hostname> for the requested service URL with a certificate "
    + `from the ${settings.certResolver} resolver. The grant's lanAddress `
    + "(when configured) is the proxy IP to point a dns.local record at.",
  requestSchema: {
    type: "object",
    required: ["hostname", "serviceUrl"],
    additionalProperties: false,
    properties: {
      hostname: { type: "string" },
      serviceUrl: { type: "string" },
    },
  },
  grantSchema: {
    type: "object",
    required: ["hostname", "url"],
    additionalProperties: false,
    properties: {
      hostname: { type: "string" },
      url: { type: "string" },
      lanAddress: { type: "string" },
    },
  },
});
