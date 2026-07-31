import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "./http";
import type { JsonRecord, RouteDescriptor, RouteDocs } from "./skills/types";

// The runtime describes its HTTP surface as an OpenAPI 3.1 document served at
// the conventional well-known path. The document is generated from the same
// route registry the dispatcher matches against (built-in endpoints plus every
// skill RouteBinding), so it cannot drift from what actually serves. Routes
// carry optional `docs` metadata; an undocumented route still appears with a
// generic operation, and `docs.hidden` keeps static assets out of the document.
export const OPENAPI_PATH = "/openapi.json";

const OPENAPI_VERSION = "3.1.0";
const JSON_CONTENT = "application/json";

const queryParameters = (docs: RouteDocs): readonly JsonRecord[] =>
  (docs.query ?? []).map((parameter) => ({
    name: parameter.name,
    in: "query",
    required: parameter.required,
    description: parameter.description,
    schema: { type: "string" },
  }));

const responses = (docs: RouteDocs): JsonRecord =>
  Object.fromEntries(
    (docs.responses ?? [{ status: HTTP_OK, description: "Success" }]).map(
      (response) => [String(response.status), {
        description: response.description,
        ...(response.contentType !== undefined
          && { content: { [response.contentType]: {} } }),
      }],
    ),
  );

const requestBody = (docs: RouteDocs): JsonRecord | undefined => {
  const body = docs.requestBody;
  if (body === undefined) return undefined;
  return {
    description: body.description,
    required: true,
    content: {
      [body.contentType]: body.schema === undefined
        ? {}
        : { schema: body.schema },
    },
  };
};

const operation = (route: RouteDescriptor): JsonRecord => {
  const docs = route.docs ?? {};
  const body = requestBody(docs);
  const parameters = queryParameters(docs);
  return {
    summary: docs.summary ?? `${route.method} ${route.path}`,
    ...(docs.description !== undefined && { description: docs.description }),
    ...(docs.tags !== undefined && { tags: docs.tags }),
    ...(parameters.length > 0 && { parameters }),
    ...(body !== undefined && { requestBody: body }),
    responses: responses(docs),
  };
};

export const buildOpenApiDocument = (
  title: string,
  version: string,
  endpoints: readonly RouteDescriptor[],
): JsonRecord => {
  const paths: Record<string, Record<string, JsonRecord>> = {};
  for (const route of endpoints) {
    if (route.docs?.hidden === true) continue;
    const path = (paths[route.path] ??= {});
    path[route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: OPENAPI_VERSION,
    info: { title, version },
    paths,
  };
};

const HEALTH_ENDPOINT: RouteDescriptor = {
  method: "GET",
  path: "/healthz",
  docs: {
    summary: "Runtime health and readiness",
    description: "Readiness gates on boot completing and every required "
      + "skill install succeeding; a degraded install answers 503.",
    tags: ["runtime"],
    responses: [
      {
        status: HTTP_OK,
        description: "Runtime is ready",
        contentType: JSON_CONTENT,
      },
      {
        status: HTTP_SERVICE_UNAVAILABLE,
        description: "Runtime is booting or a required install failed",
        contentType: JSON_CONTENT,
      },
    ],
  },
};

const COMPONENTS_ENDPOINT: RouteDescriptor = {
  method: "GET",
  path: "/v1/components",
  docs: {
    summary: "Loaded skill packages",
    description: "Name, kind, and protocols of every loaded package.",
    tags: ["runtime"],
    responses: [
      {
        status: HTTP_OK,
        description: "Package summaries",
        contentType: JSON_CONTENT,
      },
    ],
  },
};

const EVOLUTION_ENDPOINTS: readonly RouteDescriptor[] = [{
  method: "POST",
  path: "/v1/control/evolution",
  docs: {
    summary: "Evolution control plane",
    description: "Bearer-guarded self-evolution operations (POST only).",
    tags: ["control"],
    requestBody: {
      description: "Control operation",
      contentType: JSON_CONTENT,
    },
  },
}];

const GOVERNANCE_ENDPOINTS: readonly RouteDescriptor[] = [
  {
    method: "GET",
    path: "/v1/control/governance",
    docs: {
      summary: "Governance status",
      description: "Bearer-guarded freeze state and disabled tool set.",
      tags: ["control"],
    },
  },
  {
    method: "POST",
    path: "/v1/control/governance",
    docs: {
      summary: "Governance kill switch",
      description: "Bearer-guarded disable/enable of one tool or "
        + "freeze/unfreeze of the whole tool surface.",
      tags: ["control"],
      requestBody: {
        description: "Kill-switch operation",
        contentType: JSON_CONTENT,
        schema: {
          type: "object",
          required: ["op"],
          properties: {
            op: {
              type: "string",
              enum: ["disable", "enable", "freeze", "unfreeze"],
            },
            tool: { type: "string" },
          },
        },
      },
    },
  },
];

const OPENAPI_ENDPOINT: RouteDescriptor = {
  method: "GET",
  path: OPENAPI_PATH,
  docs: {
    summary: "This OpenAPI 3.1 document",
    tags: ["runtime"],
    responses: [
      {
        status: HTTP_OK,
        description: "The runtime's generated API description",
        contentType: JSON_CONTENT,
      },
    ],
  },
};

// The endpoints app.ts dispatches before consulting the skill route registry.
// Control-plane paths only appear when the corresponding plane is bound.
export const builtinEndpoints = (bound: {
  readonly evolution: boolean;
  readonly governance: boolean;
}): readonly RouteDescriptor[] => [
  HEALTH_ENDPOINT,
  COMPONENTS_ENDPOINT,
  ...(bound.evolution ? EVOLUTION_ENDPOINTS : []),
  ...(bound.governance ? GOVERNANCE_ENDPOINTS : []),
  OPENAPI_ENDPOINT,
];
