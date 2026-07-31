import { describe, expect, it } from "bun:test";
import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../../src/runtime/http";
import {
  buildOpenApiDocument,
  builtinEndpoints,
  OPENAPI_PATH,
} from "../../src/runtime/openapi";
import type {
  JsonRecord,
  RouteDescriptor,
} from "../../src/runtime/skills/types";

const TITLE = "test runtime API";
const VERSION = "0.0.0-test";

const build = (endpoints: readonly RouteDescriptor[]): JsonRecord =>
  buildOpenApiDocument(TITLE, VERSION, endpoints);

const paths = (
  document: JsonRecord,
): Record<string, Record<string, JsonRecord>> =>
  document["paths"] as Record<string, Record<string, JsonRecord>>;

describe("buildOpenApiDocument", () => {
  it("emits an OpenAPI 3.1 envelope with the runtime identity", () => {
    const document = build([]);
    expect(document["openapi"]).toBe("3.1.0");
    expect(document["info"]).toEqual({ title: TITLE, version: VERSION });
    expect(document["paths"]).toEqual({});
  });

  it("gives an undocumented route a generic operation with a 200 response", () => {
    const document = build([{ method: "GET", path: "/v1/thing" }]);
    const operation = paths(document)["/v1/thing"]?.["get"];
    expect(operation?.["summary"]).toBe("GET /v1/thing");
    expect(operation?.["responses"]).toEqual({
      [String(HTTP_OK)]: { description: "Success" },
    });
  });

  it("omits hidden routes entirely", () => {
    const document = build([
      { method: "GET", path: "/assets/app.js", docs: { hidden: true } },
      { method: "GET", path: "/v1/thing" },
    ]);
    expect(Object.keys(paths(document))).toEqual(["/v1/thing"]);
  });

  it("merges multiple methods under one path item", () => {
    const document = build([
      { method: "GET", path: "/v1/thing" },
      { method: "POST", path: "/v1/thing" },
    ]);
    expect(Object.keys(paths(document)["/v1/thing"] ?? {})).toEqual([
      "get",
      "post",
    ]);
  });

  it("maps docs metadata onto the operation object", () => {
    const document = build([{
      method: "POST",
      path: "/v1/send",
      docs: {
        summary: "Send",
        description: "Sends a message.",
        tags: ["messaging"],
        query: [{ name: "id", description: "The id", required: true }],
        requestBody: {
          description: "Payload",
          contentType: "application/json",
          schema: { type: "object" },
        },
        responses: [
          {
            status: HTTP_OK,
            description: "Sent",
            contentType: "application/json",
          },
          { status: HTTP_SERVICE_UNAVAILABLE, description: "Busy" },
        ],
      },
    }]);
    const operation = paths(document)["/v1/send"]?.["post"];
    expect(operation?.["summary"]).toBe("Send");
    expect(operation?.["description"]).toBe("Sends a message.");
    expect(operation?.["tags"]).toEqual(["messaging"]);
    expect(operation?.["parameters"]).toEqual([{
      name: "id",
      in: "query",
      required: true,
      description: "The id",
      schema: { type: "string" },
    }]);
    expect(operation?.["requestBody"]).toEqual({
      description: "Payload",
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    });
    expect(operation?.["responses"]).toEqual({
      [String(HTTP_OK)]: {
        description: "Sent",
        content: { "application/json": {} },
      },
      [String(HTTP_SERVICE_UNAVAILABLE)]: { description: "Busy" },
    });
  });
});

describe("builtinEndpoints", () => {
  it("always describes health, components, and the document itself", () => {
    const endpoints = builtinEndpoints({ evolution: false, governance: false });
    const table = endpoints.map((route) => `${route.method} ${route.path}`);
    expect(table).toEqual([
      "GET /healthz",
      "GET /v1/components",
      `GET ${OPENAPI_PATH}`,
    ]);
  });

  it("adds control-plane paths only when the planes are bound", () => {
    const endpoints = builtinEndpoints({ evolution: true, governance: true });
    const table = endpoints.map((route) => `${route.method} ${route.path}`);
    expect(table).toContain("POST /v1/control/evolution");
    expect(table).toContain("GET /v1/control/governance");
    expect(table).toContain("POST /v1/control/governance");
  });

  it("documents the health readiness gate on both statuses", () => {
    const [health] = builtinEndpoints({ evolution: false, governance: false });
    const statuses = (health?.docs?.responses ?? []).map(
      (response) => response.status,
    );
    expect(statuses).toEqual([HTTP_OK, HTTP_SERVICE_UNAVAILABLE]);
  });
});
