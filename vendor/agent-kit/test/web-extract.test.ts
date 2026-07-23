import { describe, expect, test } from "bun:test";
import { auditHtml, isRealIsoDate } from "../src/skills/web/page-audit.js";
import {
  extractLocs,
  isSitemapIndex,
  mapLimit,
  resolveSitemap,
  sitemapUrlsFromRobots,
} from "../src/skills/web/sitemap.js";

describe("sitemap (TDD §9.1)", () => {
  test("robots directives, loc extraction, index detection", () => {
    expect(
      sitemapUrlsFromRobots(
        "User-agent: *\nDisallow: /x\nSitemap: https://a/s.xml\n sitemap: https://a/s2.xml",
      ),
    ).toEqual(["https://a/s.xml", "https://a/s2.xml"]);
    expect(
      extractLocs(
        "<urlset><url><loc> https://a/p1 </loc></url><url><loc>https://a/p2</loc></url></urlset>",
      ),
    )
      .toEqual([
        "https://a/p1",
        "https://a/p2",
      ]);
    expect(
      extractLocs(
        "<loc>https://a/p1</loc><loc>https://a/p2</loc>",
        1,
      ),
    ).toEqual(["https://a/p1"]);
    expect(extractLocs("<loc>https://a/p1</loc>", 0)).toEqual([]);
    expect(isSitemapIndex("<sitemapindex xmlns=\"x\">")).toBe(true);
    expect(isSitemapIndex("<urlset>")).toBe(false);
  });

  test("mapLimit preserves order and bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test("resolveSitemap: robots → index expansion, bounded + deduped", async () => {
    const pages: Record<string, string> = {
      "https://a/robots.txt": "Sitemap: https://a/main.xml",
      "https://a/main.xml":
        "<sitemapindex><sitemap><loc>https://a/child1.xml</loc></sitemap></sitemapindex>",
      "https://a/child1.xml":
        "<urlset><url><loc>https://a/p1</loc></url><url><loc>https://a/p1</loc></url><url><loc>https://a/p2</loc></url></urlset>",
    };
    const fetchImpl =
      (async (url: string | URL | Request) =>
        pages[String(url)] === undefined
          ? new Response("", { status: 404 })
          : new Response(pages[String(url)], { status: 200 })) as typeof fetch;
    expect(await resolveSitemap({ origin: "https://a", fetchImpl })).toEqual([
      "https://a/p1",
      "https://a/p2",
    ]);
    expect(await resolveSitemap({ origin: "https://a", limit: 1, fetchImpl }))
      .toEqual(["https://a/p1"]);
  });
});

describe("page audit (TDD §9.1)", () => {
  const html = `
    <html><head>
      <title> My  Page </title>
      <meta name="description" content="A description of the page.">
      <link rel="canonical" href="https://a/p1">
      <meta property="og:title" content="x">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","datePublished":"2026-02-30","url":"/relative"}</script>
      <script type="application/ld+json">{not json</script>
    </head><body>
      <h1>One</h1><h1>Two</h1>
      <img src="http://insecure/a.png" alt="ok" width="10" height="10" loading="lazy">
      <img src="/b.png">
      <a href="/internal">in</a>
      <a href="/nf" rel="nofollow">in-nf</a>
      <a href="https://other.example/x">out</a>
      <a href="#frag">frag</a>
      some body text with several words here
    </body></html>`;

  test("extractors: meta, headings, images, anchors, mixed content, JSON-LD checks", () => {
    const audit = auditHtml("https://a/p1", html);
    expect(audit.title).toBe("My Page");
    expect(audit.metaDescription).toBe("A description of the page.");
    expect(audit.canonical).toBe("https://a/p1");
    expect(audit.h1Count).toBe(2);
    expect(audit.mixedContentCount).toBe(1);
    expect(audit.hasOpenGraph).toBe(true);
    expect(audit.hasTwitterCard).toBe(false);
    expect(audit.images).toEqual({
      total: 2,
      missingAlt: 1,
      missingDimensions: 1,
      missingLazy: 1,
    });
    expect(audit.anchors).toEqual({
      internal: 2,
      external: 1,
      nofollowInternal: 1,
    });
    expect(audit.jsonLd.blocks).toBe(2);
    expect(audit.jsonLd.invalidBlocks).toBe(1);
    expect(audit.jsonLd.types).toEqual(["Article"]);
    expect(audit.jsonLd.issues).toContain(
      "Article.datePublished is not a valid ISO date",
    );
    expect(audit.jsonLd.issues).toContain("Article.url is not an absolute URL");
  });

  test("isRealIsoDate checks shape AND calendar", () => {
    expect(isRealIsoDate("2026-07-21")).toBe(true);
    expect(isRealIsoDate("2026-07-21T09:00:00Z")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("yesterday")).toBe(false);
  });
});
