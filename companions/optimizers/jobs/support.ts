import { wireError } from "../../runtime/wire";
import type { OptimizerKind, OptimizerRequest } from "../contract";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const CANCEL_WAIT_MILLISECONDS = 2000;
export const TEMPORARY_ROOT = "/tmp";

const PASSTHROUGH_ENVIRONMENT = new Set([
  "ELLIOTT_COMPANION_FIXTURE",
  "ELLIOTT_DSPY_MODEL",
  "ELLIOTT_DARWINIAN_MODEL",
  "ELLIOTT_MODEL_PROXY_ENDPOINT",
  "ELLIOTT_MODEL_PROXY_INPUT_USD_PER_MILLION",
  "ELLIOTT_MODEL_PROXY_OUTPUT_USD_PER_MILLION",
  "ELLIOTT_MODEL_PROXY_TOKEN",
  "LANG",
  "LC_ALL",
  "PATH",
  "PYTHONPATH",
  "PYTHONUNBUFFERED",
]);

export class SerialGate {
  #tail = Promise.resolve();

  async use<A>(operation: () => Promise<A>): Promise<A> {
    const previous = this.#tail;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#tail = promise;
    await previous;
    try {
      return await operation();
    } finally {
      resolve();
    }
  }
}

export interface Job {
  readonly runId: string;
  readonly request: OptimizerRequest;
  readonly token: string;
  readonly child: Bun.Subprocess<"ignore", "ignore", "ignore">;
  readonly root: string;
  readonly resultPath: string;
  readonly deadline: number;
  readonly gate: SerialGate;
  paused: boolean;
}

export interface JobControllerConfig {
  readonly kind: OptimizerKind;
  readonly workerCommand: readonly [string, ...string[]];
  readonly sliceMilliseconds: number;
  readonly maximumJobs: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const requireRecord = (
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : wireError(`${name} must be an object`);

export const childEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && PASSTHROUGH_ENVIRONMENT.has(name)) {
      environment[name] = value;
    }
  }
  environment["PYTHONUNBUFFERED"] ??= "1";
  return environment;
};

export const errorMessage = (
  error: Readonly<Record<string, unknown>>,
): string => {
  const type = typeof error["type"] === "string" ? error["type"] : "Error";
  const message = typeof error["message"] === "string"
    ? error["message"]
    : "unknown failure";
  return `worker ${type}: ${message}`;
};
