import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import { ToolError } from "../../core/errors.js";
import { pageFetch1 } from "../../host/capabilities/contracts.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { stripHtml } from "./html.js";
import { WebpageConfig } from "./schema.js";

const WEBPAGE_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_MAX_CHARS = 8000;

const manifest: Manifest<typeof WebpageConfig.Type> = {
  id: "webpage",
  kind: "skill",
  version: "0.1.0",
  configSchema: WebpageConfig,
  bundle: "web",
  trust: "read",
  defaultTier: "fast",
  capabilities: ["reads:web"],
  contracts: { tools: ["webpage_fetch"] },
  provides: [{ capability: "page-fetch@1" }],
};

export function webpageSkill(): Registrable<typeof WebpageConfig.Type> {
  return {
    manifest,
    async activate() {
      return {
        tools: [makeWebpageTool()],
        providers: [{
          capability: "page-fetch@1",
          invoke: async (input) => {
            const args = await Effect.runPromise(
              Schema.decodeUnknownEffect(pageFetch1.input)(input),
            );
            const { status, raw } = await fetchPage(args.url);
            const content = stripHtml(raw);
            return {
              status,
              content: content.slice(
                0,
                args.maxChars ?? DEFAULT_OUTPUT_MAX_CHARS,
              ),
              format: "text",
            };
          },
        }],
      };
    },
  };
}

function makeWebpageTool(): ToolDef {
  return define({
    name: "webpage_fetch",
    description:
      "Fetch a URL and return its text (HTML tags stripped). Cheapest reader; use for simple "
      + "static pages. A non-2xx status is returned as data, not an error.",
    schema: Schema.Struct({ url: Schema.String }),
    meta: {
      componentId: "webpage",
      bundle: "web",
      core: false,
      write: false,
    },
    run: async (args) => {
      const { status, raw } = await fetchPage(args.url);
      return JSON.stringify({
        status,
        text: stripHtml(raw).slice(0, DEFAULT_OUTPUT_MAX_CHARS),
      });
    },
  });
}

function fetchPage(
  url: string,
): Promise<{ status: number; raw: string; }> {
  return Effect.runPromise(requestPage(url));
}

const requestPage = Effect.fn("skillsWeb.webpage.fetch")(
  function*(url: string) {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          signal: AbortSignal.timeout(WEBPAGE_TIMEOUT_MS),
        }),
      catch: (cause) => webpageError("request failed", cause),
    });
    const raw = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => webpageError("response read failed", cause),
    });
    return { status: response.status, raw };
  },
);

function webpageError(message: string, cause: unknown): ToolError {
  return new ToolError({
    message: `webpage ${message}: ${formatUnknownError(cause)}`,
    cause,
  });
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
