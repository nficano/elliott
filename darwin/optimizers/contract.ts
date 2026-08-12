import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { validateCodeSandboxContract } from "../../src/learning/evolution/engine/isolation";
import {
  EvolutionCandidate,
  EvolutionCandidateIdSchema,
  EvolutionCandidateUsage,
  OptimizationEngineRequest,
  OptimizationEngineResult,
} from "../../src/learning/evolution/model/index";
import {
  canonicalJson,
  decodeUnknown,
  sha256Text,
  wireError,
} from "../runtime/wire";

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const MAXIMUM_ENGINE_CANDIDATES = 100;
const CANDIDATE_ID_DIGEST_CHARACTERS = 24;
const TEXT_TARGET_CLASSES = new Set([
  "skill",
  "tool-description",
  "prompt-segment",
]);
const TEXT_ENGINE_KINDS = new Set(["gepa", "miprov2"]);
const DATASET_FIELDS = new Set([
  "id",
  "targetDigest",
  "digest",
  "splitSeed",
  "trainDigest",
  "validationDigest",
  "classification",
  "sources",
  "trainCases",
  "validationCases",
  "holdoutSealed",
]);

export type OptimizerKind = "code" | "text";
export type OptimizerRequest = typeof OptimizationEngineRequest.Type;

export class RawOptimizerCandidate
  extends Schema.Class<RawOptimizerCandidate>("RawOptimizerCandidate")({
    materializedContent: Schema.String,
    patch: Schema.String,
    trace: Schema.Json,
    usage: EvolutionCandidateUsage,
    validationScore: Schema.optionalKey(
      Schema.Number.check(Schema.isFinite()),
    ),
    parentIndex: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  })
{}

export class RawOptimizerResult
  extends Schema.Class<RawOptimizerResult>("RawOptimizerResult")({
    candidates: Schema.Array(RawOptimizerCandidate).check(
      Schema.isMaxLength(MAXIMUM_ENGINE_CANDIDATES),
    ),
  })
{}

const requireRecord = (
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return wireError(`${name} must be an object`, HTTP_BAD_REQUEST);
  }
  return Object.fromEntries(Object.entries(value));
};

const validateDatasetEnvelope = (value: unknown): void => {
  const request = requireRecord(value, "request");
  const dataset = requireRecord(request["dataset"], "dataset");
  const unexpected = Object.keys(dataset).filter(
    (field) => !DATASET_FIELDS.has(field),
  );
  if (unexpected.length > 0) {
    wireError(
      `dataset contains unexpected fields: ${
        unexpected.toSorted((left, right) => left.localeCompare(right)).join(
          ", ",
        )
      }`,
      HTTP_BAD_REQUEST,
    );
  }
};

const validateKind = (
  request: OptimizerRequest,
  kind: OptimizerKind,
): void => {
  const targetClass = request.run.target.targetClass;
  const engineKind = request.run.engineKind;
  const valid = kind === "code"
    ? targetClass === "code" && engineKind === "darwinian"
    : TEXT_TARGET_CLASSES.has(targetClass) && TEXT_ENGINE_KINDS.has(engineKind);
  if (!valid) {
    wireError(
      `${kind} optimizer does not support ${targetClass}/${engineKind}`,
      HTTP_BAD_REQUEST,
    );
  }
  if ((kind === "code") !== (request.codeSandbox !== undefined)) {
    wireError(
      kind === "code"
        ? "codeSandbox is required for code optimization"
        : "text optimizers do not accept codeSandbox",
      HTTP_BAD_REQUEST,
    );
  }
};

const validateBindings = (request: OptimizerRequest): void => {
  const { dataset, run } = request;
  if (dataset.targetDigest !== run.target.baselineDigest) {
    wireError(
      "dataset target digest does not match the run target",
      HTTP_BAD_REQUEST,
    );
  }
  if (run.datasetId !== undefined && run.datasetId !== dataset.id) {
    wireError("dataset id does not match the run", HTTP_BAD_REQUEST);
  }
  if (run.datasetDigest !== undefined && run.datasetDigest !== dataset.digest) {
    wireError("dataset digest does not match the run", HTTP_BAD_REQUEST);
  }
  if (
    run.optimizationSeed !== undefined
    && run.optimizationSeed !== request.seed
  ) {
    wireError("optimization seed does not match the run", HTTP_BAD_REQUEST);
  }
};

const validateBudgets = (request: OptimizerRequest): void => {
  const requested = [
    request.maximumCandidates,
    request.maximumTokens,
    request.maximumCostUsd,
    request.maximumDurationMilliseconds,
    request.maximumConcurrency,
  ];
  const allowed = [
    request.run.budgets.maximumCandidates,
    request.run.budgets.maximumTokens,
    request.run.budgets.maximumCostUsd,
    request.run.budgets.maximumDurationMilliseconds,
    request.run.budgets.maximumConcurrency,
  ];
  if (
    requested.some((value, index) => {
      const limit = allowed[index];
      return limit !== undefined && value > limit;
    })
  ) {
    wireError("optimizer request exceeds the run budget", HTTP_BAD_REQUEST);
  }
};

const validateSandbox = (request: OptimizerRequest): void => {
  if (request.codeSandbox === undefined) return;
  try {
    Effect.runSync(validateCodeSandboxContract(request.codeSandbox));
  } catch {
    wireError("codeSandbox violates the isolation contract", HTTP_BAD_REQUEST);
  }
};

export const decodeOptimizerRequest = (
  value: unknown,
  kind: OptimizerKind,
): OptimizerRequest => {
  validateDatasetEnvelope(value);
  const request = decodeUnknown(
    OptimizationEngineRequest,
    value,
    "optimizer request",
  );
  validateKind(request, kind);
  validateBindings(request);
  validateBudgets(request);
  validateSandbox(request);
  return request;
};

const parentId = (
  candidates: readonly EvolutionCandidate[],
  index: number | undefined,
): EvolutionCandidate["id"] | undefined => {
  if (index === undefined) return undefined;
  const candidate = candidates[index];
  return candidate === undefined
    ? wireError("worker parentIndex is invalid", HTTP_INTERNAL_SERVER_ERROR)
    : candidate.id;
};

const makeCandidate = (
  request: OptimizerRequest,
  raw: RawOptimizerCandidate,
  candidates: readonly EvolutionCandidate[],
): EvolutionCandidate => {
  const candidateDigest = sha256Text(raw.materializedContent);
  const parentCandidateId = parentId(candidates, raw.parentIndex);
  return EvolutionCandidate.make({
    id: EvolutionCandidateIdSchema.make(
      `evc_${
        candidateDigest.slice(
          "sha256:".length,
          "sha256:".length + CANDIDATE_ID_DIGEST_CHARACTERS,
        )
      }`,
    ),
    runId: request.run.id,
    targetDigest: request.run.target.baselineDigest,
    candidateDigest,
    ...(parentCandidateId !== undefined && { parentCandidateId }),
    patch: raw.patch,
    materializedContent: raw.materializedContent,
    engineTraceDigest: sha256Text(canonicalJson(raw.trace)),
    ...(raw.validationScore !== undefined
      && { validationScore: raw.validationScore }),
    usage: raw.usage,
    constraints: [],
    createdAt: new Date().toISOString(),
  });
};

export const decodeOptimizerResult = (
  value: unknown,
  request: OptimizerRequest,
): OptimizationEngineResult => {
  const raw = decodeUnknown(
    RawOptimizerResult,
    value,
    "optimizer worker result",
  );
  const candidates: EvolutionCandidate[] = [];
  const maximum = Math.min(
    request.maximumCandidates,
    MAXIMUM_ENGINE_CANDIDATES,
  );
  for (const item of raw.candidates.slice(0, maximum)) {
    candidates.push(makeCandidate(request, item, candidates));
  }
  return OptimizationEngineResult.make({
    runId: request.run.id,
    candidates,
    paused: false,
  });
};
