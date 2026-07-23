import * as Effect from "effect/Effect";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import type { ToolDef } from "../../core/agent/types.js";
import type { Active } from "../registry/types.js";
import { resolveDeferredTree } from "./interpolate.js";
import { SpecJobError } from "./jobs-compile.js";
import type {
  CompiledJob,
  CompiledTurnStep,
  CompiledUsesStep,
  SpecJobDeps,
  SpecJobQueueLike,
} from "./types.js";

/**
 * Spec-job execution (AGENT-SPEC §1.3 `jobs:`) — the sequential step executor
 * for jobs compiled by ./jobs-compile.ts. A `uses:` step activates the skill
 * lazily through the registry and executes the tool's own `execute` (args
 * validated by its schema); a `turn:` step runs a full agent turn via
 * RuntimeApi.runTurn. Step outputs chain through `${{ steps.<id>.outputs.* }}`,
 * resolved right before each step runs.
 *
 * Wiring: the compiled ScheduleSpecs ride AgentKitOptions.schedules (so the
 * PgScheduler persists + fires them exactly like any other schedule), and
 * `registerSpecJobHandlers` then OVERRIDES the generic `sched:<id>` prompt
 * handler that bootstrap's registerScheduleHandlers installed with this step
 * executor — same job kind, spec-defined body. Call it after createAgentKit()
 * returns and before start().
 */

export { compileJobs, SpecJobError } from "./jobs-compile.js";

/** A runnable for one compiled job; returns the outputs map (test-friendly). */
export function makeSpecJobRunner(params: {
  readonly job: CompiledJob;
  readonly deps: SpecJobDeps;
}): () => Promise<Record<string, unknown>> {
  return () => runSpecJob(params.job, params.deps);
}

/**
 * Register a `sched:<agent>:<job>` handler per compiled job — the explicit
 * seam into the real scheduler path. jobs.handle() overwrites by kind, so this
 * replaces the generic prompt-based handler for exactly these schedules.
 */
export function registerSpecJobHandlers(params: {
  readonly jobs: SpecJobQueueLike;
  readonly compiled: readonly CompiledJob[];
  readonly deps: SpecJobDeps;
}): void {
  for (const job of params.compiled) {
    const run = makeSpecJobRunner({ job, deps: params.deps });
    params.jobs.handle(`sched:${job.id}`, async () => {
      await run();
    });
  }
}

async function runSpecJob(
  job: CompiledJob,
  deps: SpecJobDeps,
): Promise<Record<string, unknown>> {
  const outputs: Record<string, unknown> = {};
  for (const step of job.steps) {
    try {
      outputs[step.id] = step.type === "uses"
        ? await runUsesStep({ job, step, deps, outputs })
        : await runTurnStep({ job, step, deps, outputs });
    } catch (error) {
      const failure = error instanceof SpecJobError
        ? error
        : new SpecJobError(
          `agent "${job.agent}" job "${job.job}" step "${step.id}" failed: ${
            message(error)
          }`,
          { cause: error },
        );
      // Spec-job seam (§12): step-tagged capture; the queue seam dedupes.
      deps.reporter?.captureException(failure, {
        mechanism: "spec-job",
        handled: true,
        tags: {
          job: job.job,
          agent: job.agent,
          step: step.id,
          component: "spec",
        },
      });
      throw failure;
    }
  }
  return outputs;
}

async function runUsesStep(options: {
  readonly job: CompiledJob;
  readonly step: CompiledUsesStep;
  readonly deps: SpecJobDeps;
  readonly outputs: Record<string, unknown>;
}): Promise<unknown> {
  const { job, step, deps, outputs } = options;
  const args = resolveDeferredTree(step.args, { steps: outputs });
  const tool = await findTool(step, deps);
  const result = await Effect.runPromise(
    Effect.match(tool.execute(args, toolCtx(job.id)), {
      onSuccess: (ok) => ({ ok: true as const, value: ok }),
      onFailure: (err) => ({ ok: false as const, value: err.message }),
    }),
  );
  if (!result.ok) throw new Error(result.value);
  const parsed = parseMaybeJson(result.value);
  // Skills report internal failures as `{"error": "..."}` SUCCESS payloads so
  // the model can read them; for a job step that's a failure — surface it here
  // instead of letting `${{ steps.* }}` interpolation fail cryptically later.
  const reported = errorPayload(parsed);
  if (reported !== undefined) throw new Error(reported);
  return parsed;
}

function errorPayload(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record["error"] === "string"
    ? record["error"]
    : undefined;
}

async function findTool(
  step: CompiledUsesStep,
  deps: SpecJobDeps,
): Promise<ToolDef> {
  const pool: ToolDef[] = [];
  const problems: string[] = [];
  for (const id of step.registrableIds) {
    let active: Active;
    try {
      active = await deps.registry.activate(id);
    } catch (error) {
      problems.push(`${id}: ${message(error)}`);
      continue;
    }
    const tools = [
      ...(active.tools ?? []),
      ...(step.allowWrite ? active.writeTools ?? [] : []),
    ];
    for (const name of step.toolNames) {
      const tool = tools.find((t) => t.name === name);
      if (tool) return tool;
    }
    pool.push(...tools);
  }
  // A skill exposing exactly one tool needs no op-name match.
  if (pool.length === 1) return pool[0]!;
  throw new Error(
    `no tool matching [${step.toolNames.join(", ")}] for "${step.uses}"`
      + ` — available: [${pool.map((t) => t.name).join(", ")}]`
      + (problems.length > 0 ? `; activation: ${problems.join("; ")}` : ""),
  );
}

async function runTurnStep(options: {
  readonly job: CompiledJob;
  readonly step: CompiledTurnStep;
  readonly deps: SpecJobDeps;
  readonly outputs: Record<string, unknown>;
}): Promise<unknown> {
  const { job, step, deps, outputs } = options;
  const promptPath = nodePath.join(deps.assetsDir, step.promptPath);
  let prompt: string;
  try {
    prompt = await readFile(promptPath, "utf8");
  } catch {
    throw new Error(`turn prompt file not found: ${promptPath}`);
  }
  const text = step.context === undefined
    ? prompt
    : `${prompt}\n\n## Context\n${
      JSON.stringify(
        resolveDeferredTree(step.context, { steps: outputs }),
        null,
        2,
      )
    }`;
  const result = await deps.runtime.runTurn({
    conversationKey: `job:${job.id}`,
    agentId: job.agent,
    text,
    origin: "internal",
    ...(step.tier && { tier: step.tier }),
  });
  return { text: result.text };
}

function toolCtx(jobId: string): {
  traceId: string;
  sessionId: string;
  conversationKey: string;
  origin: "internal";
} {
  const traceId = crypto.randomUUID();
  return {
    traceId,
    sessionId: `job:${jobId}:${traceId}`,
    conversationKey: `job:${jobId}`,
    origin: "internal",
  };
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
