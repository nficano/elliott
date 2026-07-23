import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import { ToolError } from "../../core/errors.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import { SitemapConfig } from "./schema.js";
import type { ResolveSitemapParams } from "./types.js";

/**
 * Sitemap resolution (CAPABILITIES-TDD §9.1): robots.txt `Sitemap:` directives
 * first, then /sitemap.xml and /sitemap_index.xml; expands ONE level of a
 * sitemap index over a bounded child count. Fetches raw XML itself — a sitemap
 * is not a "page", so `page-fetch@1` (which may strip/render) is wrong here.
 * Pure parsing helpers are exported for reuse and tests.
 */

const MAX_INDEX_CHILDREN = 8;
export const CRAWL_CONCURRENCY = 5;
const DEFAULT_SITEMAP_LIMIT = 200;
const SITEMAP_FETCH_TIMEOUT_MS = 15_000;

export function sitemapUrlsFromRobots(robotsTxt: string): string[] {
  return robotsTxt
    .split(/\r?\n/)
    .map((line) => /^\s*sitemap:\s*(\S+)/i.exec(line)?.[1])
    .filter((u): u is string => Boolean(u));
}

export function extractLocs(xml: string, limit = Infinity): string[] {
  if (limit <= 0) return [];
  const locs: string[] = [];
  for (const loc of iterateLocs(xml)) {
    locs.push(loc);
    if (locs.length >= limit) break;
  }
  return locs;
}

function* iterateLocs(xml: string): Generator<string> {
  const matcher = /<loc>([^<]*)<\/loc>/gi;
  let match = matcher.exec(xml);
  while (match) {
    const loc = match[1]!.trim();
    if (loc) yield loc;
    match = matcher.exec(xml);
  }
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Bounded-concurrency map — the crawl primitive (order-preserving). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Resolve a site's sitemap into a bounded, deduped page-URL list. */
export async function resolveSitemap(
  params: ResolveSitemapParams,
): Promise<string[]> {
  const fetchText = makeFetchText(params.fetchImpl ?? fetch);
  const limit = params.limit ?? DEFAULT_SITEMAP_LIMIT;
  const origin = params.origin.replace(/\/$/, "");
  const robots = await fetchText(`${origin}/robots.txt`);
  const candidates = sitemapCandidates(origin, robots);
  const pages = new Set<string>();
  for (const candidate of candidates) {
    const resolved = await resolveCandidate(candidate, fetchText);
    addUntilLimit(pages, resolved, limit);
    if (pages.size > 0 || pages.size >= limit) break;
  }
  return [...pages];
}

function makeFetchText(doFetch: typeof fetch) {
  return (url: string): Promise<string | null> =>
    Effect.runPromise(
      fetchSitemapText(doFetch, url).pipe(
        Effect.match({
          onFailure: () => null,
          onSuccess: (body) => body,
        }),
      ),
    );
}

const fetchSitemapText = Effect.fn("skillsWeb.sitemap.fetch")(
  function*(doFetch: typeof fetch, url: string) {
    const response = yield* Effect.tryPromise({
      try: () =>
        doFetch(url, {
          signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
        }),
      catch: (cause) => sitemapError("request failed", cause),
    });
    if (!response.ok) return null;
    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => sitemapError("response read failed", cause),
    });
  },
);

function sitemapError(message: string, cause: unknown): ToolError {
  return new ToolError({
    message: `sitemap ${message}: ${formatUnknownError(cause)}`,
    cause,
  });
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sitemapCandidates(origin: string, robots: string | null): string[] {
  return [
    ...(robots ? sitemapUrlsFromRobots(robots) : []),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];
}

async function resolveCandidate(
  candidate: string,
  fetchText: (url: string) => Promise<string | null>,
): Promise<string[]> {
  const xml = await fetchText(candidate);
  if (!xml) return [];
  if (!isSitemapIndex(xml)) return extractLocs(xml);
  const children = extractLocs(xml, MAX_INDEX_CHILDREN);
  const bodies = await mapLimit(children, CRAWL_CONCURRENCY, fetchText);
  return bodies.flatMap((body) => body ? extractLocs(body) : []);
}

function addUntilLimit(
  target: Set<string>,
  values: readonly string[],
  limit: number,
): void {
  for (const value of values) {
    if (target.size >= limit) return;
    target.add(value);
  }
}

export function sitemapSkill(): Registrable<typeof SitemapConfig.Type> {
  const manifest: Manifest<typeof SitemapConfig.Type> = {
    id: "sitemap",
    kind: "skill",
    version: "0.1.0",
    configSchema: SitemapConfig,
    bundle: "web",
    trust: "read",
    defaultTier: "fast",
    capabilities: ["reads:web"],
    contracts: { tools: ["sitemap_list"] },
  };
  return {
    manifest,
    async activate(ctx) {
      const tool = define({
        name: "sitemap_list",
        description:
          "List the configured site's pages from its sitemap (robots.txt directives, then "
          + "/sitemap.xml, one index level). Use to enumerate pages before auditing; bounded, deduped.",
        schema: Schema.Struct({
          limit: Schema.optional(
            Schema.Number.check(
              Schema.isInt(),
              Schema.isGreaterThan(0),
            ),
          ),
        }),
        meta: {
          componentId: "sitemap",
          bundle: "web",
          core: false,
          write: false,
        },
        run: async (a) => {
          const urls = await resolveSitemap({
            origin: ctx.config.origin,
            limit: Math.min(a.limit ?? ctx.config.limit, ctx.config.limit),
          });
          return JSON.stringify({ count: urls.length, urls });
        },
      });
      return { tools: [tool] };
    },
  };
}
