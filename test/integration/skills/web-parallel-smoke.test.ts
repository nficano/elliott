import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for web-parallel. See
// docs/explanation/testing-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("web-parallel skill logic (Tier 1)", () => {
  it("stays dormant without a parallel API key", async () => {
    const { context } = await makeSmokeContext({ parallelApiKey: undefined });
    const registration = await loadOneSkill("web-parallel", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("searches and returns compact title/url/excerpts results", async () => {
    const stub = stubFetch([{
      match: "api.parallel.ai",
      body: JSON.stringify({
        results: [
          {
            title: "Example",
            url: "https://example.com/",
            excerpts: ["a snippet"],
          },
        ],
      }),
    }]);
    const { context } = await makeSmokeContext({ parallelApiKey: "x" });
    const tool = toolByName(
      await loadOneSkill("web-parallel", context),
      "parallel_search",
    );
    const result = JSON.parse(await tool.execute({ objective: "find docs" }));
    expect(result).toEqual([
      {
        title: "Example",
        url: "https://example.com/",
        excerpts: ["a snippet"],
      },
    ]);
    expect(stub.calls).toHaveLength(1);
  });
});
