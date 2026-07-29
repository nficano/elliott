import { isJsonRecord } from "../../../../src/providers/http";
import {
  objectSchema,
  requiredString,
} from "../../../../src/runtime/skills/http";
import type {
  SkillContext,
  SkillRegistration,
} from "../../../../src/runtime/skills/types";
import type {
  HomeAssistantSettings,
  ToolDefinition,
} from "../../../../src/runtime/types";

const REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const MAX_ENTITIES = 300;
const ENTITY_ID = /^[a-z_]+\.[\w-]+$/i;
const SERVICE_PART = /^[a-z_]+$/;

export const register = (context: SkillContext): SkillRegistration => {
  const settings = context.settings.homeAssistant;
  if (settings === undefined) return {};
  return {
    tools: [stateTool(settings), entitiesTool(settings), serviceTool(settings)],
  };
};

const stateTool = (settings: HomeAssistantSettings): ToolDefinition => ({
  name: "ha_state",
  description: "Read the current state and attributes of one Home Assistant "
    + "entity by entity_id (e.g. light.kitchen).",
  inputSchema: objectSchema({ entity_id: { type: "string" } }, ["entity_id"]),
  execute: async (input) => {
    const entityId = requiredString(input, "entity_id");
    if (!ENTITY_ID.test(entityId)) {
      throw new Error(`Invalid entity_id: ${entityId}`);
    }
    const payload = await haRequest(settings, `/api/states/${entityId}`);
    return JSON.stringify(payload);
  },
});

const entitiesTool = (settings: HomeAssistantSettings): ToolDefinition => ({
  name: "ha_entities",
  description: "List Home Assistant entities (entity_id, state, name), "
    + "optionally filtered by domain (e.g. light, switch, sensor).",
  inputSchema: objectSchema({ domain: { type: "string" } }, []),
  execute: async (input) => {
    const domain = isJsonRecord(input) && typeof input["domain"] === "string"
      ? input["domain"]
      : undefined;
    const payload = await haRequest(settings, "/api/states");
    if (!Array.isArray(payload)) {
      throw new TypeError("Home Assistant returned an invalid state list");
    }
    const entities = payload
      .filter(isJsonRecord)
      .map(compactEntity)
      .filter((entity) =>
        domain === undefined || entity.entity_id.startsWith(`${domain}.`)
      );
    return JSON.stringify(entities.slice(0, MAX_ENTITIES));
  },
});

const serviceTool = (settings: HomeAssistantSettings): ToolDefinition => ({
  name: "ha_call_service",
  description: "Call a Home Assistant service (e.g. domain light, service "
    + "turn_on) against an entity. This changes real device state — "
    + "explain the action before calling it.",
  inputSchema: objectSchema({
    domain: { type: "string" },
    service: { type: "string" },
    entity_id: { type: "string" },
    data: { type: "object" },
  }, ["domain", "service", "entity_id"]),
  execute: async (input) => {
    const domain = requiredString(input, "domain");
    const service = requiredString(input, "service");
    if (!SERVICE_PART.test(domain) || !SERVICE_PART.test(service)) {
      throw new Error(`Invalid service: ${domain}.${service}`);
    }
    const entityId = requiredString(input, "entity_id");
    if (!ENTITY_ID.test(entityId)) {
      throw new Error(`Invalid entity_id: ${entityId}`);
    }
    const data = isJsonRecord(input) && isJsonRecord(input["data"])
      ? input["data"]
      : {};
    const payload = await haRequest(
      settings,
      `/api/services/${domain}/${service}`,
      { ...data, entity_id: entityId },
    );
    return JSON.stringify(payload);
  },
});

const compactEntity = (
  entity: Readonly<Record<string, unknown>>,
): { readonly entity_id: string; } & Readonly<Record<string, unknown>> => {
  const attributes = entity["attributes"];
  const name = isJsonRecord(attributes) ? attributes["friendly_name"] : "";
  return {
    entity_id: typeof entity["entity_id"] === "string"
      ? entity["entity_id"]
      : "",
    state: typeof entity["state"] === "string" ? entity["state"] : "",
    name: typeof name === "string" ? name : "",
  };
};

const haRequest = async (
  settings: HomeAssistantSettings,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const response = await fetch(new URL(path, settings.baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${settings.token}`,
      "content-type": "application/json",
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    throw new Error(`Home Assistant returned HTTP ${response.status}`);
  }
  return response.json();
};
