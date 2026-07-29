import { describe, expect, it } from "bun:test";
import { parseDuckDuckGoResults } from "../src/parser";

describe("DuckDuckGo parser evolution target", () => {
  it("extracts a sanitized result and redirect destination", () => {
    const html = `
      <a class="result__a"
         href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=x">
        Example &amp; Company
      </a>
      <a class="result__snippet" href="https://example.com/">
        A <b>useful</b> result.
      </a>
    `;
    expect(parseDuckDuckGoResults(html)).toEqual([{
      title: "Example & Company",
      url: "https://example.com/",
      snippet: "A useful result.",
    }]);
  });

  it("rejects active and malformed result destinations", () => {
    expect(parseDuckDuckGoResults(`
      <a class="result__a" href="javascript:alert(1)">Broken</a>
    `)).toEqual([]);
  });
});
