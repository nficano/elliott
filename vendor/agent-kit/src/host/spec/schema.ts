import { Cron } from "croner";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { formatSchemaError } from "../../core/errors.js";
import { parseUses } from "./refs.js";
import type { AgentSpecFile, SpecJob, SpecStep } from "./types.js";

/**
 * The agent-spec file schema (AGENT-SPEC §1). One YAML file defines one agent;
 * `parseAgentSpec` is the single entry: structural pre-checks (unknown
 * top-level keys, a step is exactly one of `uses:`/`turn:`) → Effect Schema
 * decode → post-checks (kebab-case ids, cron validity, uses-ref grammar).
 * Interpolation happens AFTER validation, on the decoded tree.
 */

export class SpecValidationError extends Error {}

const TierName = Schema.Literals([
  "utility",
  "trivial",
  "fast",
  "standard",
  "deep",
]);

const PermissionLevelSchema = Schema.Literals(["read", "write", "none"]);

const UsesImportSchema = Schema.Struct({
  uses: Schema.String,
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  secrets: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const TurnModelSchema = Schema.Union([
  TierName,
  Schema.Struct({
    tier: TierName,
    profile: Schema.optional(Schema.String),
  }),
]);

const TurnBlockSchema = Schema.Struct({
  prompt: Schema.String,
  model: Schema.optional(TurnModelSchema),
  context: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  tools: Schema.optional(Schema.Array(UsesImportSchema)),
});

const UsesStepSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  uses: Schema.String,
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  secrets: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const TurnStepSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  turn: TurnBlockSchema,
});

const StepSchema = Schema.Union([UsesStepSchema, TurnStepSchema]);

const JobTriggerSchema = Schema.Struct({
  schedule: Schema.optional(Schema.String),
  manual: Schema.optional(Schema.Boolean),
});

const JobSchema = Schema.Struct({
  on: JobTriggerSchema,
  steps: Schema.Array(StepSchema),
});

/** `model:` — `default:` plus per-job tier overrides inline. */
const ModelBlockSchema = Schema.StructWithRest(
  Schema.Struct({ default: Schema.optional(TierName) }),
  [Schema.Record(Schema.String, TierName)],
);

export const AgentSpecFileSchema = Schema.Struct({
  name: Schema.String,
  persona: Schema.optional(Schema.String),
  channels: Schema.optional(Schema.Array(Schema.String)),
  model: Schema.optional(ModelBlockSchema),
  config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  mcp: Schema.optional(Schema.Array(UsesImportSchema)),
  permissions: Schema.optional(
    Schema.Record(Schema.String, PermissionLevelSchema),
  ),
  tools: Schema.optional(Schema.Array(UsesImportSchema)),
  jobs: Schema.optional(Schema.Record(Schema.String, JobSchema)),
});

const TOP_LEVEL_KEYS = new Set([
  "name",
  "persona",
  "channels",
  "model",
  "config",
  "mcp",
  "permissions",
  "tools",
  "jobs",
]);

const KEBAB = /^[a-z][a-z0-9-]*$/;

export function parseAgentSpec(params: {
  readonly file: string;
  readonly raw: unknown;
}): AgentSpecFile {
  const { file, raw } = params;
  precheck(file, raw);
  const parsed = Schema.decodeUnknownResult(AgentSpecFileSchema)(raw);
  if (Result.isFailure(parsed)) {
    throw new SpecValidationError(
      `${file}: invalid agent spec: ${formatSchemaError(parsed.failure)}`,
    );
  }
  const spec = parsed.success as AgentSpecFile;
  postcheck(file, spec);
  return spec;
}

/** Structural checks the Schema cannot express (pre-decode, on raw YAML). */
function precheck(file: string, raw: unknown): void {
  if (!isRecord(raw)) {
    throw new SpecValidationError(`${file}: agent spec must be a mapping`);
  }
  const unknown = Object.keys(raw).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (unknown.length > 0) {
    throw new SpecValidationError(
      `${file}: unknown top-level key(s): ${unknown.join(", ")} — allowed: ${
        [...TOP_LEVEL_KEYS].join(", ")
      }`,
    );
  }
  if (!isRecord(raw.jobs)) return;
  for (const [jobName, job] of Object.entries(raw.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) continue;
    job.steps.forEach((step: unknown, i: number) => {
      precheckStep({ file, jobName, step, index: i });
    });
  }
}

function precheckStep(params: {
  readonly file: string;
  readonly jobName: string;
  readonly step: unknown;
  readonly index: number;
}): void {
  const { file, jobName, step, index } = params;
  const at = `${file}: job "${jobName}" step ${index + 1}`;
  if (!isRecord(step)) {
    throw new SpecValidationError(`${at}: a step must be a mapping`);
  }
  const hasUses = "uses" in step;
  const hasTurn = "turn" in step;
  if (hasUses === hasTurn) {
    throw new SpecValidationError(
      `${at}: a step is exactly one of \`uses:\` or \`turn:\``,
    );
  }
}

function postcheck(file: string, spec: AgentSpecFile): void {
  if (!KEBAB.test(spec.name)) {
    throw new SpecValidationError(
      `${file}: agent name "${spec.name}" must be kebab-case`,
    );
  }
  for (const imp of [...(spec.tools ?? []), ...(spec.mcp ?? [])]) {
    checkUsesRef(file, imp.uses);
  }
  for (const [jobName, job] of Object.entries(spec.jobs ?? {})) {
    postcheckJob({ file, jobName, job });
  }
}

function postcheckJob(params: {
  readonly file: string;
  readonly jobName: string;
  readonly job: SpecJob;
}): void {
  const { file, jobName, job } = params;
  const at = `${file}: job "${jobName}"`;
  if (!KEBAB.test(jobName)) {
    throw new SpecValidationError(`${at}: job name must be kebab-case`);
  }
  if (job.on.schedule === undefined && job.on.manual !== true) {
    throw new SpecValidationError(
      `${at}: \`on:\` needs a \`schedule:\` cron or \`manual: true\``,
    );
  }
  if (job.on.schedule !== undefined) checkCron({ at, cron: job.on.schedule });
  if (job.steps.length === 0) {
    throw new SpecValidationError(`${at}: needs at least one step`);
  }
  for (const step of job.steps) postcheckStep({ file, at, step });
}

function postcheckStep(params: {
  readonly file: string;
  readonly at: string;
  readonly step: SpecStep;
}): void {
  const { file, at, step } = params;
  if (step.id !== undefined && !KEBAB.test(step.id)) {
    throw new SpecValidationError(
      `${at}: step id "${step.id}" must be kebab-case`,
    );
  }
  if ("uses" in step) checkUsesRef(file, step.uses);
  if ("turn" in step) {
    for (const imp of step.turn.tools ?? []) checkUsesRef(file, imp.uses);
  }
}

function checkCron(params: { readonly at: string; readonly cron: string; }): void {
  try {
    new Cron(params.cron);
  } catch (error) {
    throw new SpecValidationError(
      `${params.at}: invalid cron "${params.cron}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function checkUsesRef(file: string, uses: string): void {
  try {
    parseUses(uses);
  } catch (error) {
    throw new SpecValidationError(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
