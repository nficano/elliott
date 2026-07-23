import type { Tier } from "../../core/types.js";
import type { ScheduleSpec } from "../registry/types.js";
import { parseUses, toolCandidates } from "./refs.js";
import type {
  AgentSpecFile,
  CompiledJob,
  CompiledStep,
  CompiledTurnStep,
  CompiledUsesStep,
  CompileJobsParams,
  PermissionLevel,
  SpecStep,
  TurnStep,
  UsesStep,
} from "./types.js";

/**
 * Spec-job compilation (AGENT-SPEC §1.3 `jobs:`) — each job compiles to (a) a
 * durable ScheduleSpec (`<agent>:<job>`, §15) and (b) the step list its
 * executor (./jobs.ts) runs sequentially. Step outputs chain through
 * `${{ steps.<id>.outputs.* }}`, resolved right before each step runs.
 */

export class SpecJobError extends Error {}

const DEFAULT_TURN_STEP_ID = "turn";

export function compileJobs(params: CompileJobsParams): CompiledJob[] {
  const { agent, spec } = params;
  const out: CompiledJob[] = [];
  for (const [jobName, job] of Object.entries(spec.jobs ?? {})) {
    const id = `${agent}:${jobName}`;
    const tier = jobTier(spec, jobName);
    const steps = job.steps.map((step) =>
      compileStep({ params, jobName, step, tier })
    );
    assertUniqueStepIds({ agent, jobName, steps });
    const schedule: ScheduleSpec | undefined = job.on.schedule === undefined
      ? undefined
      : {
        id,
        cron: job.on.schedule,
        agentId: agent,
        ...(tier && { tier }),
      };
    out.push({
      agent,
      job: jobName,
      id,
      manual: job.on.manual === true,
      ...(schedule && { schedule }),
      steps,
    });
  }
  return out;
}

/** Per-job tier: the spec `model:` block's inline per-job override. */
function jobTier(spec: AgentSpecFile, jobName: string): Tier | undefined {
  return spec.model?.[jobName] ?? spec.model?.default;
}

function compileStep(options: {
  readonly params: CompileJobsParams;
  readonly jobName: string;
  readonly step: SpecStep;
  readonly tier: Tier | undefined;
}): CompiledStep {
  const { params, jobName, step, tier } = options;
  return "uses" in step
    ? compileUsesStep({ params, jobName, step })
    : compileTurnStep({ step, tier });
}

function compileUsesStep(options: {
  readonly params: CompileJobsParams;
  readonly jobName: string;
  readonly step: UsesStep;
}): CompiledUsesStep {
  const { params, jobName, step } = options;
  const parsed = parseUses(step.uses);
  const domain = parsed.kind === "local" ? parsed.id : parsed.skill;
  const level = permittedLevel({ params, jobName, step, domain });
  const op = parsed.kind === "registry" ? parsed.op : undefined;
  return {
    type: "uses",
    id: step.id ?? op ?? domain,
    uses: step.uses,
    registrableIds: params.resolveSkillIds(parsed),
    toolNames: parsed.kind === "registry" && parsed.op !== undefined
      ? toolCandidates(parsed.skill, parsed.op)
      : [snake(domain)],
    allowWrite: level === "write",
    args: step.with ?? {},
  };
}

/** GH-Actions-style permission gate: `none` means nothing materializes. */
function permittedLevel(options: {
  readonly params: CompileJobsParams;
  readonly jobName: string;
  readonly step: UsesStep;
  readonly domain: string;
}): PermissionLevel {
  const { params, jobName, step, domain } = options;
  const level = params.spec.permissions?.[domain] ?? "read";
  if (level === "none") {
    throw new SpecJobError(
      `agent "${params.agent}" job "${jobName}": step uses "${step.uses}" but `
        + `permissions declare ${domain}: none — nothing materializes from that skill`,
    );
  }
  return level;
}

function compileTurnStep(options: {
  readonly step: TurnStep;
  readonly tier: Tier | undefined;
}): CompiledTurnStep {
  const { step, tier } = options;
  const model = step.turn.model;
  const stepTier = typeof model === "string" ? model : model?.tier;
  const effective = stepTier ?? tier;
  return {
    type: "turn",
    id: step.id ?? DEFAULT_TURN_STEP_ID,
    promptPath: step.turn.prompt,
    ...(effective && { tier: effective }),
    ...(step.turn.context !== undefined && { context: step.turn.context }),
  };
}

function assertUniqueStepIds(options: {
  readonly agent: string;
  readonly jobName: string;
  readonly steps: readonly CompiledStep[];
}): void {
  const seen = new Set<string>();
  for (const step of options.steps) {
    if (seen.has(step.id)) {
      throw new SpecJobError(
        `agent "${options.agent}" job "${options.jobName}": duplicate step id "${step.id}"`
          + ` — give the step an explicit \`id:\``,
      );
    }
    seen.add(step.id);
  }
}

function snake(s: string): string {
  return s.replaceAll("-", "_");
}
