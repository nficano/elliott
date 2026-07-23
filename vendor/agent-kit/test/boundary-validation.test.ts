import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TelegramUpdatesResponseSchema } from "../src/channels/telegram.js";
import { parseObserverReport } from "../src/plugins/self-improve/observer.js";
import { parseProposals } from "../src/plugins/self-improve/reflection.js";
import { BrowserClient } from "../src/skills/web/browser/client.js";
import {
  BraveSearchResponseSchema,
  BrowserScrapeResponseSchema,
  FirecrawlScrapeResponseSchema,
  FirecrawlSearchResponseSchema,
} from "../src/skills/web/schema.js";

afterEach(() => {
  mock.restore();
});

describe("external payload validation", () => {
  test("rejects malformed Telegram updates", async () => {
    await expectDecodeFailure(
      TelegramUpdatesResponseSchema,
      "{\"ok\":true,\"result\":[{\"update_id\":\"not-a-number\"}]}",
    );
  });

  test("rejects malformed Brave and Firecrawl responses", async () => {
    await expectDecodeFailure(
      BraveSearchResponseSchema,
      "{\"web\":{\"results\":[{\"title\":\"x\",\"url\":\"https://x\",\"description\":42}]}}",
    );
    await expectDecodeFailure(
      FirecrawlSearchResponseSchema,
      "{\"data\":[{\"title\":false,\"url\":\"https://x\"}]}",
    );
    await expectDecodeFailure(
      FirecrawlScrapeResponseSchema,
      "{\"data\":{\"markdown\":{\"unexpected\":\"object\"}}}",
    );
  });

  test("rejects malformed browser scrape responses", async () => {
    await expectDecodeFailure(
      BrowserScrapeResponseSchema,
      "{\"data\":[{\"selector\":\"main\",\"results\":[{\"text\":42}]}]}",
    );

    const client = new BrowserClient({
      daemonUrl: "https://browser.test",
      allowedDomains: [],
    });
    mockFetch(async () =>
      new Response(
        "{\"data\":[{\"selector\":\"main\",\"results\":[{\"text\":42}]}]}",
      )
    );
    await expect(client.scrape("https://example.com", ["main"]))
      .rejects.toThrow("invalid payload");
  });

  test("treats malformed observer and reflection output as empty", () => {
    expect(parseObserverReport(
      "{\"trigger\":\"missed_constraint\",\"message\":42}",
    )).toBeNull();
    expect(parseObserverReport(
      "{\"trigger\":\"invented\",\"message\":\"stop\"}",
    )).toBeNull();
    expect(parseProposals(
      "{\"proposals\":[{\"type\":\"prompt\",\"target\":\"x\",\"rationale\":12}]}",
    )).toEqual([]);
    expect(parseProposals("not json")).toEqual([]);
  });
});

async function expectDecodeFailure<T>(
  schema: Schema.Decoder<T>,
  json: string,
): Promise<void> {
  const result = await Effect.runPromise(
    Effect.result(
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(json),
    ),
  );
  expect(result._tag).toBe("Failure");
}

function mockFetch(
  implementation: (...args: Parameters<typeof fetch>) => Promise<Response>,
): void {
  const fetchImplementation = Object.assign(implementation, {
    preconnect: globalThis.fetch.preconnect,
  });
  spyOn(globalThis, "fetch").mockImplementation(fetchImplementation);
}
