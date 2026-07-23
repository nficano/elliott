import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import { ToolError } from "../../core/errors.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import {
  auditAnchors,
  auditImages,
  auditJsonLd,
} from "./page-audit/helpers.js";
import { PageAuditConfig } from "./schema.js";
import { stripHtml } from "./search.js";
import type { PageAudit } from "./types.js";

export { isRealIsoDate } from "./page-audit/helpers.js";

const PAGE_AUDIT_TIMEOUT_MS = 15_000;

/**
 * Page hygiene audit (CAPABILITIES-TDD §9.1) — pure regex extractors over raw
 * server-rendered HTML (no DOM), plus GENERIC JSON-LD structural checks
 * (parseable, typed, absolute URLs, real ISO dates). Domain rubrics (rich-result
 * taxonomies, scoring formulas) deliberately stay out (§25). The skill fetches
 * raw HTML itself: an audit needs the markup, not a readable rendering.
 */

export function auditHtml(url: string, html: string): PageAudit {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    attrOf(html, /<meta[^>]+name=["']description["'][^>]*>/i, "content")
      ?? attrOf(
        html,
        /<meta[^>]+content=["'][^"']*["'][^>]+name=["']description["'][^>]*>/i,
        "content",
      );
  const canonical = attrOf(
    html,
    /<link[^>]+rel=["']canonical["'][^>]*>/i,
    "href",
  );
  const text = stripHtml(html);

  return {
    url,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    descriptionLength: metaDescription?.length ?? 0,
    canonical,
    h1Count: countMatches(html, /<h1[\s>]/gi),
    wordCount: text ? text.split(/\s+/).length : 0,
    mixedContentCount: url.startsWith("https://")
      ? countMatches(html, /(?:src|href)=["']http:\/\//gi)
      : 0,
    hasOpenGraph: /<meta[^>]+property=["']og:/i.test(html),
    hasTwitterCard: /<meta[^>]+name=["']twitter:/i.test(html),
    images: auditImages(html),
    jsonLd: auditJsonLd(html),
    anchors: auditAnchors(html, url),
  };
}

function countMatches(html: string, re: RegExp): number {
  const flags = re.global ? re.flags : `${re.flags}g`;
  const matcher = new RegExp(re.source, flags);
  let count = 0;
  let match = matcher.exec(html);
  while (match) {
    count++;
    if (match[0].length === 0) matcher.lastIndex++;
    match = matcher.exec(html);
  }
  return count;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? m[1]!.replaceAll(/\s+/g, " ").trim() : null;
}

function attrOf(html: string, tagRe: RegExp, attr: string): string | null {
  const tag = tagRe.exec(html)?.[0];
  if (!tag) return null;
  const m = new RegExp(String.raw`\b${attr}=["']([^"']*)["']`, "i").exec(tag);
  return m ? m[1]!.trim() : null;
}

// ── the skill ──

export function pageAuditSkill(): Registrable<typeof PageAuditConfig.Type> {
  const manifest: Manifest<typeof PageAuditConfig.Type> = {
    id: "page-audit",
    kind: "skill",
    version: "0.1.0",
    configSchema: PageAuditConfig,
    bundle: "web",
    trust: "read",
    defaultTier: "fast",
    capabilities: ["reads:web"],
    contracts: { tools: ["page_audit"] },
  };
  return {
    manifest,
    async activate() {
      const tool = define({
        name: "page_audit",
        description:
          "Audit one page's hygiene from its raw HTML: title/description presence+length, canonical, "
          + "H1 count, word count, mixed content, image alt/dimensions/lazy, OG/Twitter tags, JSON-LD "
          + "structural validity, anchor rel hygiene. Structural facts only — you judge severity.",
        schema: Schema.Struct({ url: Schema.String }),
        meta: {
          componentId: "page-audit",
          bundle: "web",
          core: false,
          write: false,
        },
        run: async (a) => {
          const result = await Effect.runPromise(fetchAuditPage(a.url));
          if (!result.ok) {
            return JSON.stringify({
              url: a.url,
              status: result.status,
              error: "non-2xx",
            });
          }
          return JSON.stringify(auditHtml(a.url, result.html));
        },
      });
      return { tools: [tool] };
    },
  };
}

const fetchAuditPage = Effect.fn("skillsWeb.pageAudit.fetch")(
  function*(url: string) {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          signal: AbortSignal.timeout(PAGE_AUDIT_TIMEOUT_MS),
        }),
      catch: (cause) => pageAuditError("request failed", cause),
    });
    if (!response.ok) return auditFailure(response.status);
    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => pageAuditError("response read failed", cause),
    });
    return auditSuccess(response.status, html);
  },
);

function auditFailure(status: number): {
  readonly ok: false;
  readonly status: number;
} {
  return { ok: false, status };
}

function auditSuccess(
  status: number,
  html: string,
): { readonly ok: true; readonly status: number; readonly html: string; } {
  return { ok: true, status, html };
}

function pageAuditError(message: string, cause: unknown): ToolError {
  return new ToolError({
    message: `page audit ${message}: ${formatUnknownError(cause)}`,
    cause,
  });
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
