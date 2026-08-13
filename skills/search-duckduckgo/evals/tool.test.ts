import { describe, expect, it, spyOn } from "bun:test";
import { searchTool } from "../src/index";

// Exercises the tool contract directly (register()'s settings gate — off by
// default, opt-in via tools.search_duckduckgo.enabled — is covered by
// test/integration/skills/search-duckduckgo-smoke.test.ts through the real
// loader).
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
      const tool = searchTool();
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
    const tool = searchTool();
    expect(tool.execute({ query: 7 })).rejects.toThrow(
      "Tool argument query must be a string",
    );
  });
});
