import { describe, expect, it } from "bun:test";
import { parseDuckDuckGoResults } from "../../skills/search-duckduckgo/src";

describe("DuckDuckGo HTML search", () => {
  it("extracts result titles, destination URLs, and snippets", () => {
    const html = `
      <div class="result results_links">
        <h2>
          <a class="result__a"
             href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=test">
            Example &amp; Company
          </a>
        </h2>
        <a class="result__snippet" href="https://example.com/">
          A <b>useful</b> example result.
        </a>
      </div>
    `;

    expect(parseDuckDuckGoResults(html)).toEqual([{
      title: "Example & Company",
      url: "https://example.com/",
      snippet: "A useful example result.",
    }]);
  });

  it("ignores malformed result links", () => {
    expect(parseDuckDuckGoResults(`
      <a class="result__a" href="javascript:alert(1)">Broken</a>
    `)).toEqual([]);
  });
});
