import { HTTP_BAD_REQUEST, HTTP_OK } from "../../../src/runtime/http";
import type { RouteDocs } from "../../../src/runtime/skills/types";

// OpenAPI metadata for the deep-trace route table, surfaced through the
// runtime's generated /openapi.json. Kept apart from the handlers so the
// route table stays readable.
const DOCS_TAGS = ["deep-trace"] as const;
const HTML_CONTENT = "text/html";
const JSON_CONTENT = "application/json";
const SSE_CONTENT = "text/event-stream";

const okResponse = (description: string, contentType: string): RouteDocs => ({
  tags: [...DOCS_TAGS],
  responses: [{ status: HTTP_OK, description, contentType }],
});

export const routeDocs = {
  ui: {
    summary: "Deep-trace explorer UI",
    description: "The isometric telemetry map (Nuxt build when present, "
      + "legacy single-file document otherwise).",
    ...okResponse("Explorer document", HTML_CONTENT),
  },
  legacy: {
    summary: "Legacy single-file map UI",
    ...okResponse("Legacy explorer document", HTML_CONTENT),
  },
  topology: {
    summary: "Connection-graph topology document",
    description: "The enriched base topology merged with every "
      + "auto-registered skill package and facility grant edge.",
    ...okResponse("Topology nodes, edges, and domains", JSON_CONTENT),
  },
  state: {
    summary: "Current aggregator snapshot",
    ...okResponse("Turns, database stats, and recent events", JSON_CONTENT),
  },
  stream: {
    summary: "Live telemetry feed",
    ...okResponse("Server-Sent Events stream", SSE_CONTENT),
  },
  turn: {
    summary: "One turn's full event detail",
    query: [{ name: "id", description: "The turn's runId", required: true }],
    tags: [...DOCS_TAGS],
    responses: [
      {
        status: HTTP_OK,
        description: "Recorded turn events",
        contentType: JSON_CONTENT,
      },
      { status: HTTP_BAD_REQUEST, description: "Missing id parameter" },
    ],
  },
  send: {
    summary: "Inject a message into the agent",
    description: "Runs a full agent turn and answers with the reply; the "
      + "SSE stream animates the turn while the request is held open.",
    tags: [...DOCS_TAGS],
    requestBody: {
      description: "Message to inject",
      contentType: JSON_CONTENT,
      schema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string" },
          sender: { type: "string" },
        },
      },
    },
    responses: [
      {
        status: HTTP_OK,
        description: "The agent's answer",
        contentType: JSON_CONTENT,
      },
      { status: HTTP_BAD_REQUEST, description: "Invalid or missing text" },
    ],
  },
} satisfies Readonly<Record<string, RouteDocs>>;
