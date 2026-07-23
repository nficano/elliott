import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import type { NotifyPort } from "../../core/notify/types.js";
import type { Tier } from "../../core/types.js";
import type { RuntimeApi } from "../runtime/types.js";
import type { Job, JobQueue } from "./types.js";

/**
 * Delegation as a tool (§14): `delegate(task, {tier, deadline})` enqueues a
 * subagent with an isolated context and returns an IMMEDIATE ack ("on it — don't
 * call again"); the result posts back into the originating conversation. This is
 * a core tool (always loaded, §10.1).
 */
export function delegateTool(jobs: JobQueue): ToolDef {
  return define({
    name: "delegate",
    description:
      "Hand a self-contained, multi-step task to a background subagent and get an immediate ack. "
      + "Use for work that would take many rounds or minutes (research, a long scrape) so the chat "
      + "stays responsive. The result is delivered to this conversation when done. Don't call again to check.",
    schema: Schema.Struct({
      task: Schema.String,
      tier: Schema.optional(
        Schema.Literals(["utility", "trivial", "fast", "standard", "deep"]),
      ),
      deadline: Schema.optional(Schema.String),
    }),
    meta: { componentId: "delegate", bundle: "ops", core: true, write: false },
    run: async (a, ctx) => {
      const id = await jobs.enqueue({
        kind: "delegate",
        payload: {
          task: a.task,
          tier: a.tier ?? "standard",
          conversationKey: ctx.conversationKey,
        },
        originConversation: ctx.conversationKey,
      });
      return JSON.stringify({
        ack:
          "On it — working in the background; I'll post the result here when done. Don't call delegate again for this.",
        jobId: id ?? "deduped",
      });
    },
  });
}

/** The handler that actually runs a delegated subagent turn (isolated context). */
export function registerDelegateHandler(
  jobs: JobQueue,
  runtime: RuntimeApi,
  deliver: (conversationKey: string, text: string) => Promise<void>,
): void {
  jobs.handle("delegate", async (job: Job) => {
    const task = typeof job.payload.task === "string" ? job.payload.task : "";
    const payloadConversation = job.payload.conversationKey;
    const conversationKey = typeof payloadConversation === "string"
      ? payloadConversation
      : job.originConversation ?? "internal";
    const tier = (job.payload.tier as Tier | undefined) ?? "standard";
    // Isolated conversation key so the subagent's history doesn't pollute the parent.
    const result = await runtime.runTurn({
      conversationKey: `delegate:${job.id}`,
      agentId: "main",
      text: task,
      origin: "internal",
    });
    void tier;
    await deliver(conversationKey, `Delegated task result:\n\n${result.text}`);
  });
}

/** Best-effort out-of-band delegation completion notice (optional, §16.4). */
export async function notifyDelegateDone(
  notify: NotifyPort | undefined,
  body: string,
): Promise<void> {
  if (!notify) return;
  await Effect.runPromise(Effect.ignore(notify.send({ body })));
}
