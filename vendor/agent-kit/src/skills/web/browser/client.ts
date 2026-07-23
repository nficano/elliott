import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ToolError } from "../../../core/errors.js";
import { BrowserScrapeResponseSchema } from "../schema.js";
import type {
  BrowserClientConfig,
  BrowserResult,
  ScrapeHit,
} from "../types.js";

const DEFAULT_MAX_OUTPUT_CHARS = 12_000;
const BROWSER_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Stateless HTTP client to the headless-Chrome daemon *container* (§3/§18) —
 * Chromium is out of the runtime image. Speaks the browserless v2 REST API
 * (`/content`, `/scrape`) which renders JS before returning, so it reads pages a
 * plain fetch can't. The call carries a token (query param) — otherwise anything
 * on the Docker network could drive Chromium (§18). Domain allow-listing gates
 * which sites may be rendered.
 */
export class BrowserClient {
  constructor(private readonly cfg: BrowserClientConfig) {}

  /** Fully-rendered HTML for a URL (JS executed). */
  async content(url: string): Promise<BrowserResult<string>> {
    this.assertAllowed(url);
    const res = await this.post("/content", { url });
    if (!res.ok) {
      return { ok: false, error: `agent-browser content ${res.status}` };
    }
    const html = await res.text();
    return {
      ok: true,
      data: html.slice(0, this.cfg.maxOutput ?? DEFAULT_MAX_OUTPUT_CHARS),
    };
  }

  /** Extract text for CSS selectors from a rendered page. */
  async scrape(
    url: string,
    selectors: readonly string[],
  ): Promise<BrowserResult<ScrapeHit[]>> {
    this.assertAllowed(url);
    const res = await this.post("/scrape", {
      url,
      elements: selectors.map((selector) => ({ selector })),
    });
    if (!res.ok) {
      return { ok: false, error: `agent-browser scrape ${res.status}` };
    }
    const json = await Effect.runPromise(
      decodeBrowserResponse(res, BrowserScrapeResponseSchema),
    );
    const hits: ScrapeHit[] = (json.data ?? []).flatMap((d) =>
      (d.results ?? []).map((r) => ({
        selector: d.selector ?? "",
        text: (r.text ?? "").trim(),
      }))
    );
    return { ok: true, data: hits };
  }

  private post(path: string, body: unknown): Promise<Response> {
    return Effect.runPromise(requestBrowser(this.cfg, path, body));
  }

  private assertAllowed(url: string): void {
    if (this.cfg.allowedDomains.length === 0) return; // empty = unrestricted (dev)
    const host = hostOf(url);
    const isOk = this.cfg.allowedDomains.some((d) =>
      host === d || host.endsWith(`.${d}`)
    );
    if (!isOk) {
      throw new ToolError({
        message: `domain not allowed: ${host} (browser.allowed_domains)`,
      });
    }
  }
}

const requestBrowser = Effect.fn("skillsWeb.browser.request")(
  function*(cfg: BrowserClientConfig, path: string, body: unknown) {
    const url = new URL(`${cfg.daemonUrl}${path}`);
    if (cfg.token) url.searchParams.set("token", cfg.token);
    return yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS),
        }),
      catch: (cause) =>
        new ToolError({
          message: `agent-browser request failed: ${formatUnknownError(cause)}`,
          cause,
        }),
    });
  },
);

function decodeBrowserResponse<T>(
  response: Response,
  schema: Schema.Decoder<T>,
): Effect.Effect<T, ToolError> {
  return Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new ToolError({
        message: `agent-browser response read failed: ${
          formatUnknownError(cause)
        }`,
        cause,
      }),
  }).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text)
    ),
    Effect.mapError((cause) =>
      cause instanceof ToolError
        ? cause
        : new ToolError({
          message: "agent-browser returned an invalid payload",
          cause,
        })
    ),
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
