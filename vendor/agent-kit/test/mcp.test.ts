import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import { makeMcpClient } from "../src/core/mcp/client.js";
import { makeHttpWire } from "../src/core/mcp/http.js";
import { makeSseWire, parseSseText } from "../src/core/mcp/sse.js";
import type {
  McpFetch,
  McpServerConfig,
  McpWire,
} from "../src/core/mcp/types.js";
import { mcpServer } from "../src/host/mcp/registrable.js";

const CFG: McpServerConfig = {
  id: "test",
  transport: "streamable-http",
  url: "https://mcp.local/mcp",
};

const TOOLS = [
  {
    name: "get_state",
    description: "read a state",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "turn_on",
    description: "flip a switch",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
  },
];

/** A wire that answers from a canned method → result map, recording calls. */
function fakeWire(results: Record<string, unknown>): McpWire & {
  calls: Array<{ method: string; params: unknown; }>;
} {
  const calls: Array<{ method: string; params: unknown; }> = [];
  return {
    calls,
    async start() {},
    async request(method, params) {
      calls.push({ method, params });
      if (!(method in results)) throw new Error(`unexpected rpc ${method}`);
      return results[method];
    },
    async notify(method) {
      calls.push({ method, params: undefined });
    },
    async close() {},
  };
}

describe("mcp client (over a fake wire)", () => {
  test("connect: initialize → initialized → tools/list with annotations", async () => {
    const wire = fakeWire({
      initialize: { protocolVersion: "2025-06-18" },
      "tools/list": { tools: TOOLS },
    });
    const client = makeMcpClient(CFG, { wire });

    const tools = await Effect.runPromise(client.connect());

    expect(wire.calls.map((c) => c.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
    expect(tools.map((t) => [t.name, t.readOnly])).toEqual([
      ["get_state", true],
      ["turn_on", false],
    ]);
    expect(client.connected).toBe(true);
  });

  test("call: joins text content parts", async () => {
    const wire = fakeWire({
      "tools/call": {
        content: [
          { type: "text", text: "line one" },
          { type: "image", data: "…" },
          { type: "text", text: "line two" },
        ],
      },
    });
    const client = makeMcpClient(CFG, { wire });

    const out = await Effect.runPromise(client.call("get_state", { id: "x" }));

    expect(out).toBe("line one\nline two");
    expect(wire.calls[0]?.params).toEqual({
      name: "get_state",
      arguments: { id: "x" },
    });
  });

  test("call: isError results fail as McpError phase call", async () => {
    const wire = fakeWire({
      "tools/call": {
        content: [{ type: "text", text: "no such entity" }],
        isError: true,
      },
    });
    const client = makeMcpClient(CFG, { wire });

    const result = await Effect.runPromise(
      Effect.result(client.call("turn_on", {})),
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.phase).toBe("call");
      expect(result.failure.message).toContain("no such entity");
    }
  });
});

describe("mcp streamable-http wire", () => {
  const rpcOk = (id: number, result: unknown): string =>
    JSON.stringify({ jsonrpc: "2.0", id, result });

  test("carries the session header and unwraps SSE-framed responses", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; }> = [];
    const fetchImpl: McpFetch = async (url, init) => {
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      seen.push({ url: String(url), headers });
      if (seen.length === 1) {
        return new Response(rpcOk(1, {}), {
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "sess-42",
          },
        });
      }
      // SSE-framed unary response, as some servers send.
      return new Response(
        `event: message\ndata: ${rpcOk(2, { pong: true })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const wire = makeHttpWire(CFG, fetchImpl);

    await wire.request("initialize", {});
    const second = await wire.request("ping");

    expect(seen[0]?.headers["mcp-session-id"]).toBeUndefined();
    expect(seen[1]?.headers["mcp-session-id"]).toBe("sess-42");
    expect(second).toEqual({ pong: true });
  });

  test("rpc errors surface with code and message", async () => {
    const fetchImpl: McpFetch = async () =>
      Response.json(
        {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32_601, message: "method not found" },
        },
        { headers: { "content-type": "application/json" } },
      );
    const wire = makeHttpWire(CFG, fetchImpl);

    expect(wire.request("nope")).rejects.toThrow(/method not found/);
  });
});

describe("mcp sse wire (Home Assistant style)", () => {
  test("endpoint handshake, then responses arrive on the stream", async () => {
    let push!: (chunk: string) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const posted: Array<Record<string, unknown>> = [];
    const fetchImpl: McpFetch = async (url, init) => {
      if (init?.method !== "POST") {
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url: String(url), ...body });
      // The server answers on the stream, not in the POST response.
      if (body["id"] !== undefined) {
        setTimeout(() => {
          push(
            `event: message\ndata: ${
              JSON.stringify({
                jsonrpc: "2.0",
                id: body["id"],
                result: { ok: body["method"] },
              })
            }\n\n`,
          );
        }, 1);
      }
      return new Response(null, { status: 202 });
    };
    const wire = makeSseWire(
      { ...CFG, transport: "sse", url: "https://ha.local/mcp_server/sse" },
      fetchImpl,
    );

    const started = wire.start();
    push("event: endpoint\ndata: /mcp_server/messages/abc123\n\n");
    await started;
    const result = await wire.request("initialize", {});

    expect(result).toEqual({ ok: "initialize" });
    expect(posted[0]?.["url"]).toBe(
      "https://ha.local/mcp_server/messages/abc123",
    );
    await wire.close();
  });

  test("parseSseText handles multi-line data and defaults event to message", () => {
    const events = parseSseText(
      "event: endpoint\ndata: /messages\n\ndata: {\"a\":\ndata: 1}\n\n",
    );
    expect(events).toEqual([
      { event: "endpoint", data: "/messages" },
      { event: "message", data: "{\"a\":\n1}" },
    ]);
  });
});

describe("mcp registrable", () => {
  test("activation splits read/write tools and prefixes names", async () => {
    const wire = fakeWire({
      initialize: {},
      "tools/list": { tools: TOOLS },
      "tools/call": { content: [{ type: "text", text: "on" }] },
    });
    const reg = mcpServer({ id: "home-assistant", bundle: "home" }, {
      clientFor: (cfg) => makeMcpClient(cfg, { wire }),
    });

    const active = await reg.activate({
      config: { url: "https://ha.local/mcp_server/sse", transport: "sse" },
      get: (() => {
        throw new Error("unused");
      }) as never,
      tier: "fast",
      profile: {},
      secrets: { token: "t0ken" },
    });

    expect(active.tools?.map((t) => t.name)).toEqual([
      "home-assistant_get_state",
    ]);
    expect(active.writeTools?.map((t) => t.name)).toEqual([
      "home-assistant_turn_on",
    ]);
    const write = active.writeTools[0];
    expect(write.meta).toMatchObject({
      componentId: "home-assistant",
      bundle: "home",
      write: true,
      core: false,
    });
    const out = await Effect.runPromise(write.execute({ id: "light.x" }, {
      traceId: "t",
      sessionId: "s",
      conversationKey: "c",
      origin: "internal",
    } as never));
    expect(out).toBe("on");
  });
});
