import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for search-brave. See
// docs/explanation/testing-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("search-brave skill logic (Tier 1)", () => {
  it("stays dormant without a brave API key", async () => {
    const { context } = await makeSmokeContext({ braveApiKey: undefined });
    const registration = await loadOneSkill("search-brave", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("searches and returns compact title/url/snippet results", async () => {
    const stub = stubFetch([{
      match: "api.search.brave.com",
      body: JSON.stringify({
        web: {
          results: [
            {
              title: "Example",
              url: "https://example.com/",
              description: "A page",
            },
          ],
        },
      }),
    }]);
    const { context } = await makeSmokeContext({ braveApiKey: "x" });
    const tool = toolByName(
      await loadOneSkill("search-brave", context),
      "brave_search",
    );
    const result = JSON.parse(await tool.execute({ query: "elliott agent" }));
    expect(result).toEqual([
      { title: "Example", url: "https://example.com/", snippet: "A page" },
    ]);
    expect(stub.calls[0]).toContain("q=elliott");
  });
});
