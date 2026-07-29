import type {
  RouteBinding,
  SkillContext,
} from "../../../src/runtime/skills/types";

const MAP_PATH = "/v1/observability/map";
const HTTP_FOUND = 302;

// The short path the published hostname advertises: https://<hostname>/map
// redirects into the canonical map document, whose asset routes are absolute.
export const mapAliasRoute = (): RouteBinding => ({
  method: "GET",
  path: "/map",
  handle: async () =>
    new Response(undefined, {
      status: HTTP_FOUND,
      headers: { location: MAP_PATH },
    }),
});

// Publishes the map on the LAN through the facility seam: an HTTPS route on
// the reverse proxy (proxy.route) chained into a DNS record pointing the
// hostname at the proxy (dns.local). Both grants are idempotent per
// (consumer, name), so reboots re-use the provisioned hostname. A failure is
// reported but never blocks the map from serving locally.
export const publishMap = async (context: SkillContext): Promise<void> => {
  const settings = context.settings.telemetryMap;
  if (settings === undefined) return;
  try {
    const route = await context.facilities.acquire("proxy.route", "public", {
      hostname: settings.publicHostname,
      serviceUrl: settings.serviceUrl,
    });
    const lanAddress = route.values["lanAddress"];
    if (typeof lanAddress !== "string") {
      throw new TypeError(
        "proxy.route grant carries no lanAddress; set tools.traefik."
          + "lan_address so the DNS record can point at the proxy",
      );
    }
    await context.facilities.acquire("dns.local", "public", {
      domain: settings.publicHostname,
      ip: lanAddress,
    });
  } catch (error) {
    context.report(error, "telemetry-map:publish");
  }
};
