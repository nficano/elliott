import type {
  RouteBinding,
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import { ingressWebhookFacility, resolveSettingsRef } from "./facility";
import { endpointPath, verificationRoute } from "./routes";
import { endpointStore } from "./store";
import type { EndpointRecord, IngressCounters } from "./types";

// The ingress.webhook facility provider (phase 1): endpoints verify inbound
// webhooks in-process behind the operator-configured hooks hostname and
// forward verified payloads to the consumer's internal route over the
// loopback. Dormant until the hooks base URL and the internal signing secret
// are both configured. See docs/explanation/skill-facilities.md.
export const register = async (
  context: SkillContext,
): Promise<SkillRegistration> => {
  const settings = context.settings.webhookProvisioner;
  const internalSecret = context.settings.webhookSecret;
  if (settings === undefined || internalSecret === undefined) return {};
  const store = endpointStore(context.stateDirectory);
  // The routes array is intentionally live: grants acquired while consumer
  // skills register (after this register() returned) mount here, and the
  // runtime collects routes only once every skill has registered.
  const routes: RouteBinding[] = [];
  const counters: IngressCounters = { verified: 0, dropped: 0 };
  const mount = (record: EndpointRecord): void => {
    const route = verificationRoute({
      record,
      material: materialResolver(context),
      internalSecret,
      port: context.settings.port,
      counters,
      report: (error, mechanism) => context.report(error, mechanism),
    });
    const current = routes.findIndex((item) => item.path === route.path);
    if (current === -1) routes.push(route);
    else routes[current] = route;
  };
  const unmount = (slug: string): void => {
    const current = routes.findIndex(
      (item) => item.path === endpointPath(slug),
    );
    if (current !== -1) routes.splice(current, 1);
  };
  for (const record of await store.all()) mount(record);
  return {
    facilities: [
      ingressWebhookFacility({
        hooksBaseUrl: settings.hooksBaseUrl,
        settings: context.settings,
        store,
        mount,
        unmount,
      }),
    ],
    routes,
    services: [ingressService(counters, routes)],
  };
};

const materialResolver = (
  context: SkillContext,
): (record: EndpointRecord) => string | undefined =>
(record) =>
  record.secretRef === undefined
    ? record.material
    : resolveSettingsRef(context.settings, record.secretRef);

// Surfaces per-boot ingress counters on /healthz: how many endpoints are
// mounted and how many payloads were verified vs dropped at the boundary.
const ingressService = (
  counters: IngressCounters,
  routes: readonly RouteBinding[],
): ServiceBinding => ({
  name: "webhook-provisioner",
  start: () => {},
  stop: () => {},
  health: () => ({
    endpoints: routes.length,
    verified: counters.verified,
    dropped: counters.dropped,
  }),
});
