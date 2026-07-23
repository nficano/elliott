import type { FirecrawlSearchResponseSchema } from "./schema.js";

export type Headers = Record<string, string>;

export type SearchResult =
  | {
    readonly ok: true;
    readonly status: number;
    readonly payload: typeof FirecrawlSearchResponseSchema.Type;
  }
  | { readonly ok: false; readonly status: number; };

export interface BrowserClientConfig {
  readonly daemonUrl: string;
  readonly token?: string | undefined;
  readonly allowedDomains: readonly string[];
  readonly maxOutput?: number | undefined;
}

export interface BrowserResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface ScrapeHit {
  readonly selector: string;
  readonly text: string;
}

export interface BraveHit {
  title: string;
  url: string;
  description: string;
}
export interface BraveHitOut {
  title: string;
  url: string;
  snippet: string;
}

export interface ImageHygiene {
  readonly total: number;
  readonly missingAlt: number;
  readonly missingDimensions: number;
  readonly missingLazy: number;
}

export interface JsonLdAudit {
  readonly blocks: number;
  readonly invalidBlocks: number;
  readonly types: readonly string[];
  readonly issues: readonly string[];
}

export interface AnchorAudit {
  readonly internal: number;
  readonly external: number;
  readonly nofollowInternal: number;
}

export interface PageAudit {
  readonly url: string;
  readonly title: string | null;
  readonly titleLength: number;
  readonly metaDescription: string | null;
  readonly descriptionLength: number;
  readonly canonical: string | null;
  readonly h1Count: number;
  readonly wordCount: number;
  readonly mixedContentCount: number;
  readonly hasOpenGraph: boolean;
  readonly hasTwitterCard: boolean;
  readonly images: ImageHygiene;
  readonly jsonLd: JsonLdAudit;
  readonly anchors: AnchorAudit;
}

export interface ResolveSitemapParams {
  readonly origin: string; // e.g. "https://example.com"
  readonly limit?: number;
  readonly fetchImpl?: typeof fetch;
}
