// Formatting helpers behind the detail drawer. Unlike the legacy inline
// script (which built innerHTML strings), these return structured data that
// Vue templates render — no manual escaping required.

const MILLION = 1e6;
const THOUSAND = 1e3;

export const fmtNum = (value: number | null | undefined, unit = ""): string => {
  if (value === null || value === undefined) return "—";
  if (value >= MILLION) return `${(value / MILLION).toFixed(1)}M${unit}`;
  if (value >= THOUSAND) return `${(value / THOUSAND).toFixed(1)}k${unit}`;
  return `${Math.round(value * 100) / 100}${unit}`;
};

export type TagTone = "" | "warn" | "danger" | "ok";

const DANGER_CLASSIFICATIONS = new Set([
  "pii",
  "sensitive-pii",
  "credentials",
]);
const WARN_CLASSIFICATIONS = new Set(["financial"]);

export const classificationTone = (value: string): TagTone => {
  const normalized = value.toLowerCase().replaceAll(" ", "-");
  if (DANGER_CLASSIFICATIONS.has(normalized)) return "danger";
  if (WARN_CLASSIFICATIONS.has(normalized)) return "warn";
  return "";
};

export interface JsonSegment {
  readonly text: string;
  readonly tone: "key" | "string" | "number" | "boolean" | "plain";
}

const JSON_TOKEN =
  /"[^"]*"\s*:|"[^"]*"|-?\b\d[\d.]*\b|\b(?:true|false|null)\b/g;

const tokenTone = (token: string): JsonSegment["tone"] => {
  if (token.endsWith(":")) return "key";
  if (token.startsWith("\"")) return "string";
  if (token === "true" || token === "false" || token === "null") {
    return "boolean";
  }
  return "number";
};

// Tokenize pretty-printed JSON into tone-tagged segments for highlighting.
export const jsonSegments = (value: unknown): JsonSegment[] => {
  const pretty = JSON.stringify(value, null, 2) ?? "";
  const segments: JsonSegment[] = [];
  let last = 0;
  for (const match of pretty.matchAll(JSON_TOKEN)) {
    const index = match.index;
    if (index > last) {
      segments.push({ text: pretty.slice(last, index), tone: "plain" });
    }
    const [token] = match;
    segments.push({ text: token, tone: tokenTone(token) });
    last = index + token.length;
  }
  if (last < pretty.length) {
    segments.push({ text: pretty.slice(last), tone: "plain" });
  }
  return segments;
};

const isPlainValue = (value: unknown): boolean =>
  value !== null && value !== undefined && typeof value !== "object";

// One-line summary of an arbitrary detail value (legacy detailSummary).
export const detailSummary = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  const label = record["id"] ?? record["topic"] ?? record["attribute"]
    ?? record["choice"] ?? record["idea"] ?? record["name"];
  const body = record["decision"] ?? record["selected"] ?? record["contract"]
    ?? record["benefit"] ?? record["risk"] ?? record["reason"]
    ?? record["change"] ?? record["description"] ?? record["outcome"]
    ?? record["mitigation"];
  if (label !== undefined && body !== undefined) return `${label}: ${body}`;
  const entries = Object.entries(record)
    .filter(([, child]) => isPlainValue(child) && !Array.isArray(child))
    .map(([key, child]) => `${key}: ${child}`)
    .join(" · ");
  return entries || JSON.stringify(value);
};

// Flatten an arbitrary detail value into bullet lines (legacy detailLines).
export const detailLines = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(detailSummary);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) =>
        Array.isArray(child)
          ? child.map((item) => `${key} — ${detailSummary(item)}`)
          : [`${key}: ${detailSummary(child)}`],
    );
  }
  return [String(value)];
};
