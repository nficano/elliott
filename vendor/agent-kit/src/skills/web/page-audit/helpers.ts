import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { AnchorAudit, ImageHygiene, JsonLdAudit } from "../types.js";

const ISO_DATE_PART_LENGTH = "YYYY-MM-DD".length;
const ISO_DATE_SEGMENT_COUNT = 3;
const ISO_YEAR_DIGITS = 4;
const ISO_MONTH_DAY_DIGITS = 2;

export function auditImages(html: string): ImageHygiene {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  let missingAlt = 0;
  let missingDimensions = 0;
  let missingLazy = 0;
  for (const image of images) {
    if (!/\balt=["'][^"']+["']/i.test(image)) missingAlt++;
    if (!/\bwidth=/i.test(image) || !/\bheight=/i.test(image)) {
      missingDimensions++;
    }
    if (!/\bloading=["']lazy["']/i.test(image)) missingLazy++;
  }
  return { total: images.length, missingAlt, missingDimensions, missingLazy };
}

export function auditJsonLd(html: string): JsonLdAudit {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((match) => match[1]!);
  const audit = {
    invalidBlocks: 0,
    types: [] as string[],
    issues: [] as string[],
  };
  for (const block of blocks) auditJsonLdBlock(block, audit);
  return { blocks: blocks.length, ...audit };
}

function auditJsonLdBlock(
  block: string,
  audit: { invalidBlocks: number; types: string[]; issues: string[]; },
): void {
  const parsed = Schema.decodeUnknownResult(
    Schema.fromJsonString(Schema.Unknown),
  )(block);
  if (Result.isFailure(parsed)) {
    audit.invalidBlocks++;
    return;
  }
  for (const entity of flattenEntities(parsed.success)) {
    auditEntity(entity, audit);
  }
}

function auditEntity(
  entity: Record<string, unknown>,
  audit: { types: string[]; issues: string[]; },
): void {
  const type = entity["@type"];
  if (typeof type !== "string") {
    audit.issues.push("entity missing @type");
    return;
  }
  audit.types.push(type);
  for (const [key, value] of Object.entries(entity)) {
    if (typeof value === "string") {
      auditProperty({ type, key, value, issues: audit.issues });
    }
  }
}

function auditProperty(
  params: {
    readonly type: string;
    readonly key: string;
    readonly value: string;
    readonly issues: string[];
  },
): void {
  if (
    /^(url|image|logo|sameAs)$/i.test(params.key) && params.value
    && !/^https?:\/\//.test(params.value)
  ) {
    params.issues.push(`${params.type}.${params.key} is not an absolute URL`);
  }
  if (
    /^date/i.test(params.key) && params.value
    && !isRealIsoDate(params.value)
  ) {
    params.issues.push(`${params.type}.${params.key} is not a valid ISO date`);
  }
}

function flattenEntities(node: unknown): Record<string, unknown>[] {
  const entities: Record<string, unknown>[] = [];
  const pending: unknown[] = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const value of current) pending.push(value);
      continue;
    }
    if (!isRecord(current)) continue;
    const graph = current["@graph"];
    if (Array.isArray(graph)) {
      for (const value of graph) pending.push(value);
    } else entities.push(current);
  }
  return entities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shape AND calendar: "2026-02-30" is not a date. */
export function isRealIsoDate(value: string): boolean {
  const parts = parseIsoDateParts(value);
  if (!parts) return false;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseIsoDateParts(value: string): [number, number, number] | null {
  const datePart = value.slice(0, ISO_DATE_PART_LENGTH);
  const parts = datePart.split("-");
  if (parts.length !== ISO_DATE_SEGMENT_COUNT) return null;
  if (!isDigits(parts[0]!, ISO_YEAR_DIGITS)) return null;
  if (!isDigits(parts[1]!, ISO_MONTH_DAY_DIGITS)) return null;
  if (!isDigits(parts[2]!, ISO_MONTH_DAY_DIGITS)) return null;
  const separator = value[ISO_DATE_PART_LENGTH];
  if (separator !== undefined && separator !== "T" && separator !== " ") {
    return null;
  }
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function isDigits(value: string, length: number): boolean {
  return value.length === length && /^\d+$/.test(value);
}

export function auditAnchors(html: string, pageUrl: string): AnchorAudit {
  const host = hostOf(pageUrl);
  const anchors = html.match(/<a\b[^>]*>/gi) ?? [];
  const counts = { internal: 0, external: 0, nofollowInternal: 0 };
  for (const anchor of anchors) {
    const kind = anchorKind(anchor, host);
    if (kind === "skip") continue;
    if (kind === "external") counts.external++;
    else {
      counts.internal++;
      if (/\brel=["'][^"']*nofollow[^"']*["']/i.test(anchor)) {
        counts.nofollowInternal++;
      }
    }
  }
  return counts;
}

function hostOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).host;
  } catch {
    return "";
  }
}

function anchorKind(
  anchor: string,
  host: string,
): "skip" | "internal" | "external" {
  const href = /\bhref=["']([^"']+)["']/i.exec(anchor)?.[1];
  if (!href) return "skip";
  if (
    href.startsWith("#") || href.startsWith("mailto:")
    || href.startsWith("javascript:")
  ) return "skip";
  const external = /^https?:\/\//.test(href) && host !== ""
    && !href.includes(`//${host}`);
  return external ? "external" : "internal";
}
