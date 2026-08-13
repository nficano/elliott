import { describe, expect, it, spyOn } from "bun:test";
import { register } from "../src/index";

describe("DuckDuckGo tool evolution target", () => {
  it("preserves the public search contract and brokered destination", async () => {
    const requests: URL[] = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request) => {
        requests.push(
          new URL(
            input instanceof Request ? input.url : input,
          ),
        );
        return new Response(`
          <a class="result__a" href="https://example.com/">Example</a>
          <a class="result__snippet">Useful result</a>
        `);
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetcher);
    try {
      const tool = register().tools?.[0];
      if (tool === undefined) throw new Error("search tool is unavailable");
      expect(tool?.name).toBe("duckduckgo_search");
      expect(tool?.inputSchema).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      });
      expect(JSON.parse(await tool.execute({ query: "safe search" })))
        .toEqual([{
          title: "Example",
          url: "https://example.com/",
          snippet: "Useful result",
        }]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.hostname).toBe("html.duckduckgo.com");
      expect(requests[0]?.searchParams.get("q")).toBe("safe search");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects malformed arguments before network access", () => {
    const tool = register().tools?.[0];
    if (tool === undefined) throw new Error("search tool is unavailable");
    expect(tool.execute({ query: 7 })).rejects.toThrow(
      "Tool argument query must be a string",
    );
  });
});
