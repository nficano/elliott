import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { parseSseText } from "../../../skills/mcp-client/src/sse";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

// Tier-1 skill-logic smoke for mcp-client. A JSON-RPC cassette over
// streamable-http drives initialize → tools/list → tools/call through the real
// wire + register path. See docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

const MCP_URL = "http://127.0.0.1:9/mcp";

const rpcResult = (
  id: unknown,
  result: unknown,
  headers?: HeadersInit,
): Response =>
  Response.json({ jsonrpc: "2.0", id, result }, {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
      "mcp-session-id": "s1",
    },
  });

const asRequest = (
  input: string | URL | Request,
  init?: RequestInit,
): Request =>
  input instanceof Request ? input : new Request(String(input), init);

const stubMcpHttp = (): { readonly methods: readonly string[]; } => {
  const methods: string[] = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = asRequest(input, init);
    const url = request.url;
    if (!url.includes("/mcp")) {
      throw new Error(`unexpected URL ${url}`);
    }
    if (request.method !== "POST") {
      throw new Error(`unexpected method ${request.method}`);
    }
    const body: unknown = await request.json();
    const method = typeof body === "object" && body !== null
        && "method" in body && typeof body.method === "string"
      ? body.method
      : "unknown";
    methods.push(method);
    const id = typeof body === "object" && body !== null && "id" in body
      ? body.id
      : undefined;
    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "smoke", version: "1.0.0" },
      });
    }
    if (method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (method === "tools/list") {
      return rpcResult(id, {
        tools: [
          {
            name: "echo",
            description: "echo input",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
          { name: "bare" },
          { bad: true },
        ],
        nextCursor: undefined,
      });
    }
    if (method === "tools/call") {
      const params = typeof body === "object" && body !== null
          && "params" in body
          && typeof body.params === "object"
          && body.params !== null
        ? body.params as Record<string, unknown>
        : {};
      if (params["name"] === "echo") {
        return rpcResult(id, {
          content: [{
            type: "text",
            text: `echo:${JSON.stringify(params["arguments"] ?? {})}`,
          }],
        });
      }
      return rpcResult(id, {
        isError: true,
        content: [{ type: "text", text: "boom" }],
      });
    }
    return rpcResult(id, {});
  };
  spyOn(globalThis, "fetch").mockImplementation(
    impl as unknown as typeof fetch,
  );
  return { methods };
};

describe("mcp-client skill logic (Tier 1)", () => {
  it("registers tools from a streamable-http endpoint and executes one", async () => {
    const cassette = stubMcpHttp();
    const { context, reported } = await makeSmokeContext({
      mcp: [{
        id: "demo",
        url: MCP_URL,
        transport: "streamable-http",
        authorization: "token",
      }],
    });
    const registration = await loadOneSkill("mcp-client", context);
    expect(reported).toEqual([]);
    expect(cassette.methods).toContain("initialize");
    expect(cassette.methods).toContain("tools/list");

    const echo = toolByName(registration, "mcp_demo_echo");
    const result = await echo.execute({ text: "hi" });
    expect(result).toContain("echo:");
    expect(result).toContain("hi");
    expect(cassette.methods).toContain("tools/call");

    const service = registration.services?.[0];
    expect(service?.name).toBe("mcp:demo");
    expect(service?.health()).toEqual({ tools: 2 });
    void service?.start();
    await service?.stop();
  });

  it("reports a failed endpoint and still boots without its tools", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      (() =>
        Promise.resolve(
          new Response("down", { status: 503 }),
        )) as unknown as typeof fetch,
    );
    const { context, reported } = await makeSmokeContext({
      mcp: [{
        id: "down",
        url: "http://127.0.0.1:9/down",
        transport: "streamable-http",
      }],
    });
    const registration = await loadOneSkill("mcp-client", context);
    expect(reported.some((item) => item.startsWith("mcp:down:"))).toBe(true);
    expect(registration.tools ?? []).toEqual([]);
  });

  it("parses SSE frames used by streamable-http and SSE transports", () => {
    const events = parseSseText(
      "event: endpoint\ndata: /messages\n\n"
        + "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n"
        + "event: message\ndata: not-json\n\n"
        + ": comment only\n\n",
    );
    expect(events).toEqual([
      { event: "endpoint", data: "/messages" },
      {
        event: "message",
        data: "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}",
      },
      { event: "message", data: "not-json" },
    ]);
  });

  it("unwraps SSE-framed HTTP RPC responses", async () => {
    const impl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = asRequest(input, init);
      const body: unknown = await request.json();
      const method = typeof body === "object" && body !== null
          && "method" in body && typeof body.method === "string"
        ? body.method
        : "";
      const id = typeof body === "object" && body !== null && "id" in body
        ? body.id
        : 1;
      if (method === "initialize") {
        return new Response(
          `event: message\ndata: ${
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                serverInfo: { name: "sse-http", version: "1" },
              },
            })
          }\n\n`,
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "mcp-session-id": "s2",
            },
          },
        );
      }
      if (method === "notifications/initialized") {
        return new Response(null, { status: 204 });
      }
      if (method === "tools/list") {
        return new Response(
          `data: not-json\n\ndata: ${
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                tools: [{ name: "ping", description: "p", inputSchema: {} }],
              },
            })
          }\n\n`,
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        );
      }
      return rpcResult(id, {
        content: [{ type: "text", text: "pong" }],
      });
    };
    spyOn(globalThis, "fetch").mockImplementation(
      impl as unknown as typeof fetch,
    );
    const { context } = await makeSmokeContext({
      mcp: [{
        id: "framed",
        url: MCP_URL,
        transport: "streamable-http",
      }],
    });
    const registration = await loadOneSkill("mcp-client", context);
    const ping = toolByName(registration, "mcp_framed_ping");
    expect(await ping.execute({})).toBe("pong");
  });
});
