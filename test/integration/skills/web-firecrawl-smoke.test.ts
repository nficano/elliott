import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for web-firecrawl. See
// docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("web-firecrawl skill logic (Tier 1)", () => {
  it("stays dormant without a firecrawl API key", async () => {
    const { context } = await makeSmokeContext({ firecrawlApiKey: undefined });
    const registration = await loadOneSkill("web-firecrawl", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("searches and returns the raw payload as JSON", async () => {
    stubFetch([{
      match: "api.firecrawl.dev/v1/search",
      body: JSON.stringify({ results: [{ title: "Example" }] }),
    }]);
    const { context } = await makeSmokeContext({ firecrawlApiKey: "x" });
    const tool = toolByName(
      await loadOneSkill("web-firecrawl", context),
      "firecrawl_search",
    );
    const result = JSON.parse(await tool.execute({ query: "elliott agent" }));
    expect(result.results).toEqual([{ title: "Example" }]);
  });

  it("rejects a non-public scrape destination before any network call", async () => {
    const stub = stubFetch([]);
    const { context } = await makeSmokeContext({ firecrawlApiKey: "x" });
    const tool = toolByName(
      await loadOneSkill("web-firecrawl", context),
      "firecrawl_scrape",
    );
    expect(() => tool.execute({ url: "http://169.254.169.254/latest" }))
      .toThrow();
    expect(stub.calls).toEqual([]);
  });
});
