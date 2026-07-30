import { readStoredGrants } from "../../../src/runtime/skills/facilities";
import type {
  RouteBinding,
  SkillContext,
} from "../../../src/runtime/skills/types";

const MAP_PATH = "/v1/observability/map";
const HTTP_FOUND = 302;

// The consumer name this skill acquired its publish grants under before the
// telemetry-map -> deep-trace rename. Grants persist in the elliott-runtime
// volume keyed by consumer, so a legacy install still carries proxy.route /
// dns.local grants (and a stale "elliott-telemetry-map-public" Traefik router)
// under this old identity after the code is renamed.
const LEGACY_CONSUMER = "telemetry-map";
const PUBLISH_GRANT_NAME = "public";

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

// One-shot boot migration for the telemetry-map -> deep-trace rename.
//
// The proxy.route grant and its Traefik router ("elliott-telemetry-map-public")
// plus the dns.local grant persist in the elliott-runtime *volume*
// (facilities/grants.json, traefik/routes.json) keyed by the *consumer* name.
// After the rename the consumer is "deep-trace", so re-acquiring publishes a
// second router ("elliott-deep-trace-public") for the same host rule while the
// legacy one lingers — two routers, one Host(). This releases the legacy grant
// (which tears down the legacy router) before the new acquire runs.
//
// Known limitation (deep-trace-rename): the scoped FacilityDirectory only lets
// a consumer release *its own* grants (RuntimeFacilityDirectory.#release guards
// on stored.consumer === consumer), so a "deep-trace" consumer cannot cleanly
// release a grant recorded under "telemetry-map". Until the facility layer
// grows a directory-level migration hook (e.g. release-as / rename-consumer),
// the attempt below fails for grants owned by the old consumer and we can only
// warn. Retiring the stale router then still needs one manual grants.json edit
// or a `traefik_route_remove` call. See docs/skills-registry.md section 10.
const migrateLegacyPublish = async (context: SkillContext): Promise<void> => {
  let legacy: readonly {
    readonly grantId: string;
    readonly facilityId: string;
  }[];
  try {
    legacy = (await readStoredGrants(context.stateDirectory))
      .filter((grant) =>
        grant.consumer === LEGACY_CONSUMER
        && grant.name === PUBLISH_GRANT_NAME
      )
      .map((grant) => ({
        grantId: grant.grant.grantId,
        facilityId: grant.facilityId,
      }));
  } catch (error) {
    context.report(error, "deep-trace:migrate");
    return;
  }
  for (const grant of legacy) {
    try {
      // Best-effort: succeeds once the facility layer permits cross-consumer
      // release; today it throws for legacy-owned grants (see the note above).
      await context.facilities.release(grant.grantId);
    } catch (error) {
      console.warn(
        `[deep-trace] legacy publish grant ${grant.grantId} (facility `
          + `${grant.facilityId}, consumer "${LEGACY_CONSUMER}") could not be `
          + "released automatically; a stale Traefik router may persist. "
          + "See the deep-trace-rename note in skills/deep-trace/src/publish.ts.",
      );
      context.report(error, "deep-trace:migrate");
    }
  }
};

// Publishes the map on the LAN through the facility seam: an HTTPS route on
// the reverse proxy (proxy.route) chained into a DNS record pointing the
// hostname at the proxy (dns.local). Both grants are idempotent per
// (consumer, name), so reboots re-use the provisioned hostname. A failure is
// reported but never blocks the map from serving locally.
export const publishMap = async (context: SkillContext): Promise<void> => {
  const settings = context.settings.deepTrace;
  if (settings === undefined) return;
  await migrateLegacyPublish(context);
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
    context.report(error, "deep-trace:publish");
  }
};
