import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type {
  RouteBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type {
  ToolDefinition,
  TraefikSettings,
} from "../../../src/runtime/types";
import { proxyRouteFacility } from "./facility";
import type { RouteStore, RouteTable } from "./types";
import { hostnameValue, routeName, serviceTarget } from "./validate";

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const DYNAMIC_CONFIG_PATH = "/v1/traefik/dynamic";
const ROUTER_PREFIX = "elliott-";
const JSON_INDENT = 2;

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.traefik;
  if (settings === undefined) return {};
  const store = routeStore(context.stateDirectory);
  return {
    tools: [
      listTool(settings, store),
      setTool(settings, store),
      removeTool(store),
    ],
    routes: [dynamicConfigRoute(settings, store)],
    facilities: [proxyRouteFacility(settings, store)],
  };
};

const routeStore = (stateDirectory: string): RouteStore => {
  const file = path.join(stateDirectory, "traefik", "routes.json");
  return {
    read: async () => {
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch {
        return {};
      }
      const value: unknown = JSON.parse(raw);
      if (!isJsonRecord(value)) return {};
      return Object.fromEntries(
        Object.entries(value).flatMap(([name, route]) => {
          if (!isJsonRecord(route)) return [];
          const hostname = route["hostname"];
          const serviceUrl = route["serviceUrl"];
          if (typeof hostname !== "string" || typeof serviceUrl !== "string") {
            return [];
          }
          return [[name, { hostname, serviceUrl }] as const];
        }),
      );
    },
    write: async (table) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(table, undefined, JSON_INDENT));
    },
  };
};

const listTool = (
  settings: TraefikSettings,
  store: RouteStore,
): ToolDefinition => ({
  name: "traefik_route_list",
  description: "List the local-domain routes Elliott publishes to Traefik, "
    + "with the live router status (including TLS/cert state) from the "
    + "Traefik API when it is reachable.",
  inputSchema: objectSchema({}, []),
  execute: async () => {
    const table = await store.read();
    return JSON.stringify({
      routes: table,
      routers: await liveRouters(settings),
    });
  },
});

const setTool = (
  settings: TraefikSettings,
  store: RouteStore,
): ToolDefinition => ({
  name: "traefik_route_set",
  description: "Create or update a Traefik route that exposes a LAN service "
    + "at https://<hostname>. Traefik picks the route up from Elliott's "
    + "dynamic-config endpoint and issues the HTTPS certificate through its "
    + `ACME resolver (${settings.certResolver}). This changes what the `
    + "reverse proxy exposes — explain the change first.",
  inputSchema: objectSchema({
    name: { type: "string" },
    hostname: { type: "string" },
    service_url: { type: "string" },
  }, ["name", "hostname", "service_url"]),
  execute: async (input) => {
    const name = routeName(requiredString(input, "name"));
    const hostname = hostnameValue(requiredString(input, "hostname"));
    const serviceUrl = serviceTarget(requiredString(input, "service_url"));
    const table = {
      ...await store.read(),
      [name]: { hostname, serviceUrl },
    };
    await store.write(table);
    return JSON.stringify({
      routes: table,
      note: `Traefik will route https://${hostname} to ${serviceUrl} and `
        + `request a certificate via ${settings.certResolver} on its next `
        + "dynamic-config poll.",
    });
  },
});

const removeTool = (store: RouteStore): ToolDefinition => ({
  name: "traefik_route_remove",
  description: "Remove a Traefik route Elliott publishes. The hostname stops "
    + "being served by the reverse proxy on Traefik's next dynamic-config "
    + "poll.",
  inputSchema: objectSchema({ name: { type: "string" } }, ["name"]),
  execute: async (input) => {
    const name = routeName(requiredString(input, "name"));
    const table = await store.read();
    if (table[name] === undefined) {
      throw new Error(`No managed route named ${name}`);
    }
    const rest = Object.fromEntries(
      Object.entries(table).filter(([key]) => key !== name),
    );
    await store.write(rest);
    return JSON.stringify({ removed: name, routes: rest });
  },
});

// The seam Traefik consumes: its HTTP provider polls this route and applies
// the returned dynamic configuration. Serving tls.certResolver on every
// router is what makes Traefik issue certificates for the local domains.
const dynamicConfigRoute = (
  settings: TraefikSettings,
  store: RouteStore,
): RouteBinding => ({
  method: "GET",
  path: DYNAMIC_CONFIG_PATH,
  handle: async () =>
    Response.json(dynamicConfig(settings, await store.read())),
});

// Traefik's parser rejects empty routers/services maps ("routers cannot be
// a standalone element"), so an empty table serializes to {} — the provider
// treats that as "no dynamic config" instead of a decode error.
const dynamicConfig = (
  settings: TraefikSettings,
  table: RouteTable,
): Readonly<Record<string, unknown>> =>
  Object.keys(table).length === 0 ? {} : ({
    http: {
      routers: Object.fromEntries(
        Object.entries(table).map(([name, route]) => [
          `${ROUTER_PREFIX}${name}`,
          {
            rule: `Host(\`${route.hostname}\`)`,
            service: `${ROUTER_PREFIX}${name}`,
            entryPoints: [settings.entryPoint],
            tls: { certResolver: settings.certResolver },
          },
        ]),
      ),
      services: Object.fromEntries(
        Object.entries(table).map(([name, route]) => [
          `${ROUTER_PREFIX}${name}`,
          { loadBalancer: { servers: [{ url: route.serviceUrl }] } },
        ]),
      ),
    },
  });

// Best-effort read of the (read-only) Traefik API so the list tool can show
// whether the proxy actually applied each route. Unreachable is not an error.
const liveRouters = async (settings: TraefikSettings): Promise<unknown> => {
  try {
    const response = await fetch(
      new URL("/api/http/routers", settings.apiUrl),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      },
    );
    if (!response.ok) return `Traefik API returned HTTP ${response.status}`;
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return "Traefik API returned invalid JSON";
    return payload.filter((item) =>
      isJsonRecord(item) && typeof item["name"] === "string"
      && item["name"].startsWith(ROUTER_PREFIX)
    );
  } catch (error) {
    return `Traefik API unreachable: ${String(error)}`;
  }
};
