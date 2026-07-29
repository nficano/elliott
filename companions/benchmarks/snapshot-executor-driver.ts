import { chmod, readFile, writeFile } from "node:fs/promises";
import { HTTP_INTERNAL_SERVER_ERROR } from "../../src/runtime/http";
import {
  canonicalJson,
  MAX_RESPONSE_BYTES,
  requireLoopbackEndpoint,
  wireError,
} from "../typescript/wire";

const OWNER_ONLY_FILE_MODE = 0o600;

const argument = (name: string): string => {
  const index = Bun.argv.indexOf(name);
  const value = index === -1 ? undefined : Bun.argv[index + 1];
  return value === undefined || value.length === 0
    ? wireError(`${name} is required`, HTTP_INTERNAL_SERVER_ERROR)
    : value;
};

const main = async (): Promise<void> => {
  const requestPath = argument("--request");
  const resultPath = argument("--result");
  const source = argument("--source");
  const revision = argument("--revision");
  const operation: unknown = JSON.parse(await readFile(requestPath, "utf8"));
  const executor = requireLoopbackEndpoint(
    Bun.env["ELLIOTT_BENCHMARK_EXECUTOR_ENDPOINT"],
    Bun.env["ELLIOTT_BENCHMARK_EXECUTOR_TOKEN"],
    "benchmark executor",
  );
  const response = await fetch(
    new URL("/v1/benchmark", executor.endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${executor.token}`,
        "content-type": "application/json",
      },
      body: canonicalJson({
        operation,
        driverSource: source,
        driverRevision: revision,
      }),
    },
  );
  if (!response.ok) {
    return wireError(
      `benchmark executor returned HTTP ${response.status}`,
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  const encoded = await response.text();
  if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
    return wireError(
      "benchmark executor result is too large",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  JSON.parse(encoded);
  await writeFile(resultPath, encoded, { mode: OWNER_ONLY_FILE_MODE });
  await chmod(resultPath, OWNER_ONLY_FILE_MODE);
};

await main();
