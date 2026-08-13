import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for search-duckduckgo. Bundling a registry skill
// into core means it's reachable by every agent unless an operator opts in
// (the registry only ran it for agents that explicitly installed it) — this
// is the dormant-by-default proof the tool's own evals/ can't provide, since
// that suite calls searchTool() directly rather than through register()'s
// settings gate. See docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("search-duckduckgo skill logic (Tier 1)", () => {
  it("stays dormant on stock config (opt-in via tools.search_duckduckgo.enabled)", async () => {
    const { context } = await makeSmokeContext({ searchDuckduckgo: undefined });
    const registration = await loadOneSkill("search-duckduckgo", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("registers and searches once enabled", async () => {
    const stub = stubFetch([
      {
        match: "html.duckduckgo.com",
        body:
          "<a class=\"result__a\" href=\"https://example.com/\">Example</a>",
      },
    ]);
    const { context } = await makeSmokeContext();
    const tool = toolByName(
      await loadOneSkill("search-duckduckgo", context),
      "duckduckgo_search",
    );
    const result = JSON.parse(await tool.execute({ query: "elliott agent" }));
    expect(result).toEqual([
      {
        title: "Example",
        url: "https://example.com/",
        snippet: "",
      },
    ]);
    expect(stub.calls[0]).toContain("q=elliott");
  });
});
