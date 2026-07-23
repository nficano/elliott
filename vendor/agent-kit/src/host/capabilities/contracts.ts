import * as Schema from "effect/Schema";
import { ConfigError } from "../../core/errors.js";
import type { CapabilityContract } from "./types.js";
import { refOf } from "./types.js";

const MAX_WEB_SEARCH_RESULTS = 20;

/**
 * The standard contract catalog (CAPABILITIES-TDD §3.2). Consumers extend it
 * with `catalog.register(...)`; a contract is pure metadata, so registering one
 * costs nothing until a provider is configured. Minor evolution of a contract
 * must be additive-optional; a breaking io change mints `<id>@<major+1>`.
 */
export class ContractCatalog {
  private readonly map = new Map<string, CapabilityContract>();

  register(contract: CapabilityContract): this {
    const ref = refOf(contract);
    if (this.map.has(ref)) {
      throw new ConfigError({
        message: `capability contract '${ref}' registered twice`,
      });
    }
    this.map.set(ref, contract);
    return this;
  }

  get(ref: string): CapabilityContract | undefined {
    return this.map.get(ref);
  }

  has(ref: string): boolean {
    return this.map.has(ref);
  }

  all(): CapabilityContract[] {
    return [...this.map.values()];
  }
}

// ── standard contracts ──

export const webSearch1 = {
  id: "web-search",
  major: 1,
  description: "Search the web; returns ranked hits with title/url/snippet.",
  input: Schema.Struct({
    query: Schema.String.check(Schema.isMinLength(1)),
    count: Schema.optional(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_WEB_SEARCH_RESULTS),
      ),
    ),
  }),
  output: Schema.Struct({
    hits: Schema.Array(
      Schema.Struct({
        title: Schema.String,
        url: Schema.String,
        snippet: Schema.String,
      }),
    ),
  }),
};

export const pageFetch1 = {
  id: "page-fetch",
  major: 1,
  description:
    "Fetch one page's content. A non-2xx status is data, not an error.",
  input: Schema.Struct({
    url: Schema.String.check(Schema.isMinLength(1)),
    maxChars: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
  }),
  output: Schema.Struct({
    status: Schema.Number.check(Schema.isInt()),
    content: Schema.String,
    format: Schema.Literals(["markdown", "text", "html"]),
  }),
};

export const metricRows1 = {
  id: "metric-rows",
  major: 1,
  description:
    "Pull the current rows of a watched metric surface: one row per tracked id "
    + "(optionally per series) with named numeric metrics. The provider IS the data source.",
  input: Schema.Struct({
    days: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
    filter: Schema.optional(Schema.String),
  }),
  output: Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        series: Schema.optional(Schema.String),
        metrics: Schema.Record(Schema.String, Schema.Number),
      }),
    ),
  }),
};

export const issueFeed1 = {
  id: "issue-feed",
  major: 1,
  description:
    "Unresolved-issue feed for spike triage. `items: null` means the FETCH failed "
    + "(load-bearing: a failed fetch must never advance baseline/seen state).",
  input: Schema.Struct({
    limit: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
    windowHours: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
  }),
  output: Schema.Struct({
    items: Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          title: Schema.String,
          count: Schema.Number,
          users: Schema.optional(Schema.Number),
          firstSeen: Schema.optional(Schema.String),
          url: Schema.optional(Schema.String),
          project: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
};

export const changeFeed1 = {
  id: "change-feed",
  major: 1,
  description:
    "Recent change events (deploys, releases) to correlate incidents against.",
  input: Schema.Struct({
    limit: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    ),
  }),
  output: Schema.Struct({
    changes: Schema.Array(
      Schema.Struct({
        ref: Schema.String,
        title: Schema.String,
        at: Schema.String, // ISO timestamp
        url: Schema.optional(Schema.String),
        ok: Schema.Boolean,
      }),
    ),
  }),
};

export function makeStandardCatalog(): ContractCatalog {
  const catalog = new ContractCatalog();
  for (
    const c of [
      webSearch1,
      pageFetch1,
      metricRows1,
      issueFeed1,
      changeFeed1,
    ]
  ) {
    catalog.register(c);
  }
  return catalog;
}
