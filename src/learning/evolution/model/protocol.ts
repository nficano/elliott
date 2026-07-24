import * as Schema from "effect/Schema";
import { EvolutionCandidate } from "./candidate";
import { EvolutionOptimizerDatasetView } from "./dataset";
import { EvolutionRunIdSchema } from "./identifiers";
import { PositiveFiniteSchema, PositiveIntSchema } from "./numeric";
import { EvolutionRun, EvolutionTarget } from "./run";

const MAXIMUM_ENGINE_CANDIDATES = 100;
const MAXIMUM_RESUME_TOKEN_CHARACTERS = 8192;
const MAXIMUM_CHECKOUT_FILES = 10_000;
const MAXIMUM_CHECKOUT_FILE_CHARACTERS = 5_000_000;

export class EvolutionCodeCheckoutFile
  extends Schema.Class<EvolutionCodeCheckoutFile>(
    "EvolutionCodeCheckoutFile",
  )({
    path: Schema.String,
    digest: Schema.String,
    content: Schema.String.check(
      Schema.isMaxLength(MAXIMUM_CHECKOUT_FILE_CHARACTERS),
    ),
    executable: Schema.Boolean,
  })
{}

export class EvolutionCodeSandboxContract
  extends Schema.Class<EvolutionCodeSandboxContract>(
    "EvolutionCodeSandboxContract",
  )({
    checkoutRef: Schema.String,
    checkoutFiles: Schema.Array(EvolutionCodeCheckoutFile).check(
      Schema.isMaxLength(MAXIMUM_CHECKOUT_FILES),
    ),
    targetFiles: Schema.Array(Schema.String),
    testCommands: Schema.Array(Schema.Array(Schema.String)),
    cpuQuota: PositiveFiniteSchema,
    memoryMb: PositiveIntSchema,
    pids: PositiveIntSchema,
    timeoutMilliseconds: PositiveIntSchema,
    networkEnabled: Schema.Literal(false),
    repositoryCredentialsMounted: Schema.Literal(false),
    gitRemotePresent: Schema.Literal(false),
    activeTreeWritable: Schema.Literal(false),
    containerRuntimeSocketMounted: Schema.Literal(false),
  })
{}

export class OptimizationEngineRequest
  extends Schema.Class<OptimizationEngineRequest>(
    "OptimizationEngineRequest",
  )({
    run: EvolutionRun,
    dataset: EvolutionOptimizerDatasetView,
    baselineContent: Schema.String,
    maximumCandidates: PositiveIntSchema,
    maximumTokens: PositiveIntSchema,
    maximumCostUsd: PositiveFiniteSchema,
    maximumDurationMilliseconds: PositiveIntSchema,
    maximumConcurrency: PositiveIntSchema,
    seed: Schema.Int,
    codeSandbox: Schema.optionalKey(EvolutionCodeSandboxContract),
  })
{}

export class OptimizationEngineResult
  extends Schema.Class<OptimizationEngineResult>("OptimizationEngineResult")({
    runId: EvolutionRunIdSchema,
    candidates: Schema.Array(EvolutionCandidate).check(
      Schema.isMaxLength(MAXIMUM_ENGINE_CANDIDATES),
    ),
    paused: Schema.Boolean,
    resumeToken: Schema.optionalKey(
      Schema.String.check(
        Schema.isMaxLength(MAXIMUM_RESUME_TOKEN_CHARACTERS),
      ),
    ),
  })
{}

export class OptimizationEngineCapabilities
  extends Schema.Class<OptimizationEngineCapabilities>(
    "OptimizationEngineCapabilities",
  )({
    engineRef: Schema.String,
    engineKinds: Schema.Array(Schema.Literals([
      "gepa",
      "miprov2",
      "darwinian",
      "fixture",
    ])),
    targetClasses: Schema.Array(Schema.Literals([
      "skill",
      "tool-description",
      "prompt-segment",
      "code",
    ])),
    pauseResume: Schema.Boolean,
    isolation: Schema.Literals(["container", "remote"]),
    maximumCandidates: Schema.Int,
  })
{}

export class EvolutionCodeCheckRequest
  extends Schema.Class<EvolutionCodeCheckRequest>(
    "EvolutionCodeCheckRequest",
  )({
    operation: Schema.Literal("checkCandidate"),
    run: EvolutionRun,
    candidate: EvolutionCandidate,
    codeSandbox: EvolutionCodeSandboxContract,
  })
{}

export class EvolutionCodeCheckReport
  extends Schema.Class<EvolutionCodeCheckReport>(
    "EvolutionCodeCheckReport",
  )({
    runId: EvolutionRunIdSchema,
    candidateId: Schema.String,
    candidateDigest: Schema.String,
    constraints: Schema.Array(
      Schema.Struct({
        constraint: Schema.String,
        passed: Schema.Boolean,
        detail: Schema.String,
        evidenceDigests: Schema.Array(Schema.String),
      }),
    ),
  })
{}

export class EvolutionTargetOperation
  extends Schema.Class<EvolutionTargetOperation>("EvolutionTargetOperation")({
    operation: Schema.Literals([
      "inspect",
      "materializeBaseline",
      "applyCandidate",
      "validateInvariant",
    ]),
    target: EvolutionTarget,
    candidate: Schema.optionalKey(EvolutionCandidate),
  })
{}
