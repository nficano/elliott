import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for the HTTP tools. The global fetch is spied with
// a cassette (see fixtures.stubFetch) so these are deterministic and offline,
// while still driving the real requestPublicUrl() helper (SSRF guard,
// DNS-pinned connection, ok-check) and the tool's own request-building and
// response-parsing. See docs/contributing/skill-e2e-smoke-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("fetch_url skill logic (Tier 1)", () => {
  it("fetches a public URL and strips active HTML", async () => {
    // Matched by Host header, not URL text: requestPublicUrl() pins the
    // connection to the resolved address, so the raw fetch() call targets
    // an IP literal, and "example.com" only survives as the Host header.
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
    expect(stub.calls).toHaveLength(1);
    // The connection target is a resolved address, not the "example.com"
    // text — proof this went through the DNS-pinned path.
    expect(stub.calls[0]).not.toContain("example.com");
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
