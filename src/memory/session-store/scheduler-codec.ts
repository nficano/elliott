import type { Database } from "bun:sqlite";
import type { CapabilityRequest } from "../../core/types";
import type { ScheduledRecurrence } from "../../scheduler/types";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseCapabilities = (
  input: string,
): readonly CapabilityRequest[] => {
  const value: unknown = JSON.parse(input);
  if (!Array.isArray(value)) throw new Error("Invalid scheduled capabilities");
  return value.map((item): CapabilityRequest => {
    if (!isRecord(item) || typeof item["capability"] !== "string") {
      throw new Error("Invalid scheduled capability");
    }
    const resources = item["resources"];
    if (
      !Array.isArray(resources)
      || resources.some((part) => typeof part !== "string")
    ) throw new Error("Invalid scheduled capability resources");
    const deferred = item["deferred"];
    if (deferred !== undefined && typeof deferred !== "boolean") {
      throw new Error("Invalid deferred capability flag");
    }
    return deferred === undefined
      ? { capability: item["capability"], resources }
      : { capability: item["capability"], resources, deferred };
  });
};

export const parsePayload = (
  input: string,
): Readonly<Record<string, unknown>> => {
  const value: unknown = JSON.parse(input);
  if (!isRecord(value)) throw new Error("Invalid scheduled payload");
  return value;
};

export const parseRecurrence = (
  input: string | null,
): ScheduledRecurrence | undefined => {
  if (input === null) return undefined;
  const value: unknown = JSON.parse(input);
  if (
    !isRecord(value) || typeof value["cron"] !== "string"
    || typeof value["failureBackoffMilliseconds"] !== "number"
    || typeof value["maximumBackoffMilliseconds"] !== "number"
    || typeof value["maximumRetryAttempts"] !== "number"
  ) throw new Error("Invalid scheduled recurrence");
  const timeZone = value["timeZone"];
  if (timeZone !== undefined && typeof timeZone !== "string") {
    throw new Error("Invalid scheduled recurrence time zone");
  }
  return {
    cron: value["cron"],
    ...(timeZone !== undefined && { timeZone }),
    failureBackoffMilliseconds: value["failureBackoffMilliseconds"],
    maximumBackoffMilliseconds: value["maximumBackoffMilliseconds"],
    maximumRetryAttempts: value["maximumRetryAttempts"],
  };
};

export const migrateScheduledJobs = (database: Database): void => {
  const columns = new Set(
    database.query<{ readonly name: string; }, []>(
      "SELECT name FROM pragma_table_info('scheduled_jobs')",
    ).all().map((column) => column.name),
  );
  if (!columns.has("recurrence")) {
    database.run("ALTER TABLE scheduled_jobs ADD COLUMN recurrence TEXT");
  }
  if (!columns.has("retry_attempt")) {
    database.run(
      "ALTER TABLE scheduled_jobs ADD COLUMN retry_attempt INTEGER",
    );
  }
};
