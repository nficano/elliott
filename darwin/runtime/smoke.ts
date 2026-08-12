import { canonicalJson, sha256Text, wireError } from "./wire";

const HTTP_INTERNAL_SERVER_ERROR = 500;
const HEALTH_ATTEMPTS = 100;
const HEALTH_RETRY_MILLISECONDS = 50;
const LAST_HEALTH_ATTEMPT = HEALTH_ATTEMPTS - 1;
const TARGET_FOOTPRINT_BYTES = 128;
const REQUIRED_CODE_CHECK_CONSTRAINTS = 3;

const argument = (name: string): string => {
  const index = Bun.argv.indexOf(name);
  const value = index === -1 ? undefined : Bun.argv[index + 1];
  return value === undefined
    ? wireError(`${name} is required`, HTTP_INTERNAL_SERVER_ERROR)
    : value;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> =>
  isRecord(value)
    ? value
    : wireError(`${name} must be an object`, HTTP_INTERNAL_SERVER_ERROR);

const endpoint = argument("--endpoint");
const path = argument("--path");
const requestPath = argument("--request");
const kind = argument("--kind");
const token = argument("--token");

const request = async (url: URL, value?: unknown): Promise<unknown> => {
  const response = await fetch(
    url,
    value === undefined
      ? undefined
      : {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(value),
      },
  );
  if (!response.ok) {
    return wireError(
      `smoke request returned HTTP ${response.status}`,
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  return response.json();
};

const baselinePayload = (
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const candidateNames = new Set([
    "candidate",
    "candidateSnapshotId",
    "benchmarkGates",
    "footprintLimits",
    "confidenceLevel",
    "bootstrapIterations",
    "multipleComparisonCount",
    "requiredConstraints",
    "evaluationPlanDigest",
  ]);
  const rawRun = value["run"];
  const dataset = value["dataset"];
  if (!isRecord(rawRun) || !isRecord(dataset)) {
    return wireError(
      "comparison fixture is invalid",
      HTTP_INTERNAL_SERVER_ERROR,
    );
  }
  const run = {
    ...Object.fromEntries(
      Object.entries(rawRun).filter(([name]) => name !== "optimizationSeed"),
    ),
    state: {
      _tag: "dataset-ready",
      datasetId: dataset["id"],
      datasetDigest: dataset["digest"],
    },
  };
  const plan = {
    ...Object.fromEntries(
      Object.entries(value).filter(([name]) => !candidateNames.has(name)),
    ),
    operation: "baseline",
    run,
    targetFootprintBytes: TARGET_FOOTPRINT_BYTES,
  };
  return {
    ...plan,
    evaluationPlanDigest: sha256Text(canonicalJson(plan)),
  };
};

for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt += 1) {
  try {
    const health = await request(new URL("/healthz", endpoint));
    if (isRecord(health) && health["status"] === "ok") break;
  } catch {
    if (attempt === LAST_HEALTH_ATTEMPT) {
      wireError("darwin did not become healthy", HTTP_INTERNAL_SERVER_ERROR);
    }
    await Bun.sleep(HEALTH_RETRY_MILLISECONDS);
  }
}

const fixture = requireRecord(
  await Bun.file(requestPath).json(),
  "smoke fixture",
);
const payload = kind === "baseline" ? baselinePayload(fixture) : fixture;
const result = requireRecord(
  await request(new URL(path, endpoint), payload),
  "smoke result",
);

const runId = () => requireRecord(payload["run"], "run")["id"];
const candidateId = () =>
  requireRecord(payload["candidate"], "candidate")["id"];

const benchmarkInvalid = (): boolean =>
  kind === "benchmark"
  && (result["benchmarkRef"] !== payload["benchmarkRef"]
    || result["passed"] !== true);

const evaluatorInvalid = (): boolean =>
  kind === "evaluator"
  && (result["runId"] !== runId()
    || result["candidateId"] !== candidateId()
    || result["passed"] !== true);

const baselineInvalid = (): boolean =>
  kind === "baseline" && result["runId"] !== runId();

const codeCheckInvalid = (): boolean =>
  kind === "code-check"
  && (result["candidateId"] !== candidateId()
    || !Array.isArray(result["constraints"])
    || result["constraints"].length !== REQUIRED_CODE_CHECK_CONSTRAINTS);

const optimizerInvalid = (): boolean => {
  if (kind !== "optimizer") return false;
  const candidates = result["candidates"];
  if (
    result["runId"] !== runId()
    || result["paused"] !== false
    || !Array.isArray(candidates)
    || candidates.length !== 1
  ) {
    return true;
  }
  return candidates.some(
    (candidate: unknown) =>
      !(isRecord(candidate)
        && candidate["runId"] === runId()
        && typeof candidate["candidateDigest"] === "string"
        && candidate["candidateDigest"].startsWith("sha256:")),
  );
};

if (optimizerInvalid()) {
  wireError("optimizer smoke result is invalid", HTTP_INTERNAL_SERVER_ERROR);
}
if (benchmarkInvalid()) {
  wireError("benchmark smoke result is invalid", HTTP_INTERNAL_SERVER_ERROR);
}
if (evaluatorInvalid()) {
  wireError("evaluation smoke result is invalid", HTTP_INTERNAL_SERVER_ERROR);
}
if (baselineInvalid()) {
  wireError("baseline smoke result is invalid", HTTP_INTERNAL_SERVER_ERROR);
}
if (codeCheckInvalid()) {
  wireError("code-check smoke result is invalid", HTTP_INTERNAL_SERVER_ERROR);
}
