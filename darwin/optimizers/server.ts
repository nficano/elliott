import { loadDarwinServerConfig, startDarwinServer } from "../runtime/http";
import { wireError } from "../runtime/wire";
import { JobController, type JobControllerConfig } from "./jobs/controller";

const DEFAULT_SLICE_SECONDS = 30;
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const argument = (
  arguments_: readonly string[],
  name: string,
): string | undefined => {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
};

const positiveNumber = (value: string, name: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : wireError(`${name} must be positive`, HTTP_INTERNAL_SERVER_ERROR);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const workerCommand = (raw: string | undefined): [string, ...string[]] => {
  if (raw === undefined) {
    return wireError(
      "--worker-command-json is required",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length === 0) {
      return wireError(
        "worker command must be a non-empty string array",
        HTTP_INTERNAL_SERVER_ERROR,
      );
    }
    const items: unknown[] = value;
    if (items.some((item) => !isNonEmptyString(item))) {
      return wireError(
        "worker command must be a non-empty string array",
        HTTP_INTERNAL_SERVER_ERROR,
      );
    }
    const [executable, ...arguments_] = items.filter(isNonEmptyString);
    return executable === undefined
      ? wireError("worker command is empty", HTTP_INTERNAL_SERVER_ERROR)
      : [executable, ...arguments_];
  } catch {
    return wireError(
      "worker command must be valid JSON",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
};

const workerKind = (
  raw: string | undefined,
): JobControllerConfig["kind"] => {
  if (raw !== "code" && raw !== "text") {
    return wireError(
      "--worker-kind must be code or text",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return raw;
};

const requiredString = (
  value: unknown,
  name: string,
): string => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return wireError("request must be an object");
  }
  const item: unknown = Reflect.get(value, name);
  return isNonEmptyString(item)
    ? item
    : wireError(`${name} must be a non-empty string`);
};

export const startJobServer = (
  arguments_: readonly string[] = Bun.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): ReturnType<typeof Bun.serve> => {
  const server = loadDarwinServerConfig(arguments_, environment, false);
  const config: JobControllerConfig = {
    kind: workerKind(argument(arguments_, "--worker-kind")),
    workerCommand: workerCommand(
      argument(arguments_, "--worker-command-json"),
    ),
    sliceMilliseconds: positiveNumber(
      argument(arguments_, "--slice-seconds")
        ?? environment["ELLIOTT_JOB_SLICE_SECONDS"]
        ?? String(DEFAULT_SLICE_SECONDS),
      "slice-seconds",
    ) * MILLISECONDS_PER_SECOND,
    maximumJobs: server.maximumJobs,
    environment,
  };
  const controller = new JobController(config);
  return startDarwinServer(server, {
    "/v1/optimize": (value) => controller.start(value),
    "/v1/pause": (value) => controller.pause(requiredString(value, "runId")),
    "/v1/resume": (value) =>
      controller.resume(requiredString(value, "resumeToken")),
    "/v1/cancel": async (value) => {
      await controller.cancel(requiredString(value, "runId"));
      return {};
    },
  });
};

if (import.meta.main) {
  startJobServer();
}
