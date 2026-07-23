import * as Effect from "effect/Effect";
import { errorMessage } from "../../core/errors.js";
import type { NotifyPort } from "../../core/notify/types.js";
import type { ScheduleSpec } from "../registry/types.js";
import { SILENT_SENTINEL } from "./types.js";
import type { ScheduledRunOptions, ScheduleHandlerOptions } from "./types.js";

const SCRIPT_OUTPUT_MAX_CHARACTERS = 8000;

export type { ScheduleHandlerOptions } from "./types.js";

/**
 * Wire scheduled-run handlers (§15). A fired schedule enqueues a `sched:<id>`
 * job; this handler runs the reused interactive body (assemble → runAgent →
 * deliver → file facts) and honors two production patterns:
 *   - `[SILENT]` sentinel → NO notification (a poller alerts only on a real
 *     change, not every tick).
 *   - `--script` pre-pass → run mechanical/deterministic work in code first and
 *     inject its stdout as context; only the reasoning runs in the model.
 */
export function registerScheduleHandlers({
  jobs,
  runtime,
  notify,
  schedules,
  reporter,
}: ScheduleHandlerOptions): void {
  for (const spec of schedules) {
    jobs.handle(
      `sched:${spec.id}`,
      () =>
        runScheduledTask({
          runtime,
          notify,
          spec,
          ...(reporter && { reporter }),
        }),
    );
  }
}

async function runScheduledTask({
  runtime,
  notify,
  spec,
  reporter,
}: ScheduledRunOptions): Promise<void> {
  try {
    const text = await buildPrompt(spec);
    const result = await runtime.runTurn({
      conversationKey: `schedule:${spec.id}`,
      agentId: spec.agentId ?? "main",
      text,
      origin: "internal",
      ...(spec.tier && { tier: spec.tier }),
    });
    await deliverResult({ notify, spec, body: result.text.trim() });
  } catch (error) {
    // Capture with schedule tags, then rethrow so the queue retries (§14).
    reporter?.captureException(error, {
      mechanism: "schedule",
      handled: true,
      tags: {
        job: spec.id,
        agent: spec.agentId ?? "main",
        component: "scheduler",
      },
    });
    throw error;
  }
}

async function buildPrompt(spec: ScheduleSpec): Promise<string> {
  const prompt = spec.prompt ?? `Run the scheduled task: ${spec.id}`;
  if (!spec.script) return prompt;
  const context = await runScript(spec.script);
  return `${prompt}\n\n[script output]\n${context}`;
}

async function deliverResult({
  notify,
  spec,
  body,
}: {
  readonly notify: NotifyPort | undefined;
  readonly spec: ScheduleSpec;
  readonly body: string;
}): Promise<void> {
  if (body === SILENT_SENTINEL || body.startsWith(SILENT_SENTINEL)) return;
  if (!notify || !spec.deliverTo?.length) return;
  // A failed delivery fails the job so the queue retries with backoff.
  await Effect.runPromise(
    notify.send({ body, channels: spec.deliverTo }).pipe(
      Effect.mapError((error) => new Error(`notify failed: ${error.message}`)),
    ),
  );
}

/** Deterministic pre-pass in code, not the model (§15). Stdout becomes context. */
async function runScript(script: string): Promise<string> {
  try {
    const proc = Bun.spawn(["sh", "-c", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.slice(0, SCRIPT_OUTPUT_MAX_CHARACTERS);
  } catch (error) {
    return `[script failed: ${errorMessage(error)}]`;
  }
}
