import { isJsonRecord } from "../../providers/http";
import type { JsonRecord } from "./types";

// A deliberately small JSON-Schema subset — object/string/number/integer/
// boolean/array with properties, required, enum, and additionalProperties —
// used to validate facility requests and grants at the acquire seam. Facility
// schemas must stay inside this subset; anything richer belongs in the
// provider's own semantic validation.

export const assertMatchesSchema = (
  value: unknown,
  schema: JsonRecord,
  label: string,
): void => {
  const problem = mismatch(value, schema, label);
  if (problem !== undefined) throw new Error(problem);
};

const mismatch = (
  value: unknown,
  schema: JsonRecord,
  label: string,
): string | undefined => {
  const kind = schema["type"];
  if (typeof kind !== "string") return undefined;
  const basic = typeMismatch(value, kind, label);
  if (basic !== undefined) return basic;
  const allowed = enumMismatch(value, schema["enum"], label);
  if (allowed !== undefined) return allowed;
  if (kind === "object") {
    return objectMismatch(value as JsonRecord, schema, label);
  }
  if (kind === "array") return arrayMismatch(value as unknown[], schema, label);
  return undefined;
};

const typeMismatch = (
  value: unknown,
  kind: string,
  label: string,
): string | undefined => {
  const check = TYPE_CHECKS[kind];
  if (check === undefined) return undefined;
  return check(value) ? undefined : `${label} must be of type ${kind}`;
};

const TYPE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  object: isJsonRecord,
  array: Array.isArray,
  string: (value) => typeof value === "string",
  boolean: (value) => typeof value === "boolean",
  number: (value) => typeof value === "number",
  integer: (value) => Number.isSafeInteger(value),
};

const enumMismatch = (
  value: unknown,
  allowed: unknown,
  label: string,
): string | undefined => {
  if (!Array.isArray(allowed)) return undefined;
  return allowed.includes(value)
    ? undefined
    : `${label} must be one of ${allowed.map(String).join(", ")}`;
};

const objectMismatch = (
  value: JsonRecord,
  schema: JsonRecord,
  label: string,
): string | undefined => {
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === "string" && value[key] === undefined) {
        return `${label} is missing required property ${key}`;
      }
    }
  }
  const properties = schema["properties"];
  if (!isJsonRecord(properties)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const property = properties[key];
    if (isJsonRecord(property)) {
      const problem = mismatch(item, property, `${label}.${key}`);
      if (problem !== undefined) return problem;
    } else if (schema["additionalProperties"] === false) {
      return `${label} has unexpected property ${key}`;
    }
  }
  return undefined;
};

const arrayMismatch = (
  value: readonly unknown[],
  schema: JsonRecord,
  label: string,
): string | undefined => {
  const items = schema["items"];
  if (!isJsonRecord(items)) return undefined;
  for (const [index, item] of value.entries()) {
    const problem = mismatch(item, items, `${label}[${index}]`);
    if (problem !== undefined) return problem;
  }
  return undefined;
};
