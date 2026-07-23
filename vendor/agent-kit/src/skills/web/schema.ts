import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_SITEMAP_LIMIT = 200;

export const ConfigSchema = Schema.StructWithRest(
  Schema.Struct({
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
    ),
    daemon_url: Schema.String,
    token: Schema.optional(Schema.String),
    allowed_domains: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    max_output: Schema.optional(Schema.Number.check(Schema.isInt())),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const BraveConfig = Schema.Record(Schema.String, Schema.Unknown);

export const FirecrawlConfig = Schema.Record(Schema.String, Schema.Unknown);

export const WebpageConfig = Schema.Record(Schema.String, Schema.Unknown);

export const PageAuditConfig = Schema.Record(Schema.String, Schema.Unknown);

export const SitemapConfig = Schema.StructWithRest(
  Schema.Struct({
    origin: Schema.String,
    limit: Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
    ).pipe(
      Schema.withDecodingDefault(Effect.succeed(DEFAULT_SITEMAP_LIMIT)),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const BraveSearchResponseSchema = Schema.Struct({
  web: Schema.optionalKey(
    Schema.Struct({
      results: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            title: Schema.String,
            url: Schema.String,
            description: Schema.String,
          }),
        ),
      ),
    }),
  ),
});

const FirecrawlSearchHitSchema = Schema.StructWithRest(
  Schema.Struct({
    title: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const FirecrawlSearchResponseSchema = Schema.StructWithRest(
  Schema.Struct({
    data: Schema.optionalKey(Schema.Array(FirecrawlSearchHitSchema)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const FirecrawlScrapeResponseSchema = Schema.StructWithRest(
  Schema.Struct({
    data: Schema.optionalKey(
      Schema.StructWithRest(
        Schema.Struct({ markdown: Schema.optionalKey(Schema.String) }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const BrowserScrapeResponseSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        selector: Schema.optionalKey(Schema.String),
        results: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              text: Schema.optionalKey(Schema.String),
              html: Schema.optionalKey(Schema.String),
            }),
          ),
        ),
      }),
    ),
  ),
});
