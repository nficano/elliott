import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { connectMcp } from "../../../skills/mcp-client/src/client";

afterEach(() => {
  mock.restore();
});

describe("mcp-client SSE transport (Tier 1)", () => {
  it("opens an SSE stream, posts RPC, and settles pending calls", async () => {
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const encoder = new TextEncoder();
    const enqueue = (chunk: string) => {
      streamController?.enqueue(encoder.encode(chunk));
    };

    const impl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = input instanceof Request
        ? input
        : new Request(String(input), init);
      const url = request.url;
      if (request.method === "GET" && url.includes("/sse")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            enqueue("event: endpoint\ndata: /messages\n\n");
          },
          cancel() {
            streamController = undefined;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (request.method === "POST" && url.includes("/messages")) {
        const body: unknown = await request.json();
        const id = typeof body === "object" && body !== null && "id" in body
          ? body.id
          : undefined;
        const method = typeof body === "object" && body !== null
            && "method" in body && typeof body.method === "string"
          ? body.method
          : "";
        queueMicrotask(() => {
          if (typeof id !== "number") return;
          if (method === "initialize") {
            enqueue(
              `data: ${
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    serverInfo: { name: "sse", version: "1" },
                  },
                })
              }\n\n`,
            );
            return;
          }
          if (method === "tools/list") {
            enqueue(
              `data: ${
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    tools: [{
                      name: "ping",
                      description: "ping",
                      inputSchema: { type: "object", properties: {} },
                    }],
                  },
                })
              }\n\n`,
            );
            return;
          }
          if (method === "tools/call") {
            enqueue(
              `data: ${
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  result: {
                    content: [{ type: "text", text: "pong" }],
                  },
                })
              }\n\n`,
            );
          }
        });
        return new Response(null, { status: 202 });
      }
      throw new Error(`unexpected ${request.method} ${url}`);
    };
    spyOn(globalThis, "fetch").mockImplementation(
      impl as unknown as typeof fetch,
    );

    const connection = await connectMcp({
      id: "sse-demo",
      url: "http://127.0.0.1:9/sse",
      transport: "sse",
      authorization: "tok",
    });
    expect(connection.tools).toHaveLength(1);
    const [tool] = connection.definitions();
    expect(await tool?.execute({})).toBe("pong");
    await connection.close();
  });

  it("fails closed when the SSE handshake returns an error status", async () => {
    spyOn(globalThis, "fetch").mockImplementation(
      (() =>
        Promise.resolve(
          new Response("no", { status: 500 }),
        )) as unknown as typeof fetch,
    );
    await expect(
      connectMcp({
        id: "bad",
        url: "http://127.0.0.1:9/sse",
        transport: "sse",
      }),
    ).rejects.toThrow(/SSE returned HTTP 500/);
  });
});
