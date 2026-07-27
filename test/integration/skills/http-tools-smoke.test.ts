import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for the HTTP tools. The global fetch is spied with a
// cassette (see fixtures.stubFetch) so these are deterministic and offline,
// while still driving the real request() helper (SSRF guard + ok-check) and the
// tool's own request-building and response-parsing. See
// docs/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("fetch_url skill logic (Tier 1)", () => {
  it("fetches a public URL and strips active HTML", async () => {
    const stub = stubFetch([{
      match: "example.com",
      body: "<script>evil()</script><p>Hello <b>world</b></p>",
      headers: { "content-type": "text/html" },
    }]);
    const { context } = await makeSmokeContext();
    const fetchTool = toolByName(
      await loadOneSkill("fetch", context),
      "fetch_url",
    );

    const result = JSON.parse(
      await fetchTool.execute({ url: "https://example.com/" }),
    );
    expect(result.status).toBe(200);
    expect(result.text).toContain("Hello");
    expect(result.text).not.toContain("evil");
    expect(stub.calls[0]).toContain("https://example.com/");
  });

  it("rejects a non-public destination before any network call", async () => {
    const stub = stubFetch([]);
    const { context } = await makeSmokeContext();
    const fetchTool = toolByName(
      await loadOneSkill("fetch", context),
      "fetch_url",
    );

    await expect(fetchTool.execute({ url: "http://169.254.169.254/latest" }))
      .rejects.toThrow();
    expect(stub.calls).toEqual([]); // SSRF guard short-circuits before fetch
  });
});

describe("brave_search skill logic (Tier 1)", () => {
  it("builds the query request and maps results", async () => {
    const stub = stubFetch([{
      match: "api.search.brave.com",
      body: JSON.stringify({
        web: {
          results: [{
            title: "Elliott",
            url: "https://elliott.example",
            description: "an agent",
          }],
        },
      }),
    }]);
    const { context } = await makeSmokeContext();
    const brave = toolByName(
      await loadOneSkill("search-brave", context),
      "brave_search",
    );

    const results = JSON.parse(
      await brave.execute({ query: "elliott", count: 3 }),
    );
    expect(results).toEqual([{
      title: "Elliott",
      url: "https://elliott.example",
      snippet: "an agent",
    }]);
    expect(stub.calls[0]).toContain("q=elliott");
    expect(stub.calls[0]).toContain("count=3");
  });

  it("surfaces an upstream HTTP error", async () => {
    stubFetch([{ match: "api.search.brave.com", status: 500, body: "boom" }]);
    const { context } = await makeSmokeContext();
    const brave = toolByName(
      await loadOneSkill("search-brave", context),
      "brave_search",
    );
    await expect(brave.execute({ query: "x" })).rejects.toThrow(/HTTP 500/);
  });
});

describe("duckduckgo_search skill logic (Tier 1)", () => {
  it("parses HTML results end-to-end through the tool", async () => {
    stubFetch([{
      match: "duckduckgo.com",
      body: `<div class="result results_links"><h2><a class="result__a"
        href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=t">
        Example</a></h2><a class="result__snippet" href="https://example.com/">
        A snippet.</a></div>`,
    }]);
    const { context } = await makeSmokeContext();
    const ddg = toolByName(
      await loadOneSkill("search-duckduckgo", context),
      "duckduckgo_search",
    );
    const results = JSON.parse(await ddg.execute({ query: "example" }));
    expect(results).toEqual([{
      title: "Example",
      url: "https://example.com/",
      snippet: "A snippet.",
    }]);
  });
});
