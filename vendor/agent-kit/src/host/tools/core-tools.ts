import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { channelFormattingTool } from "../../channels/formatting.js";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import type { MemoryPort } from "../../core/memory/types.js";
import type { NotifyPort } from "../../core/notify/types.js";
import type { CoreToolDeps } from "./types.js";

const MAX_RECALL_RESULTS = 20;
const DEFAULT_RECALL_RESULTS = 5;

export function buildCoreTools(deps: CoreToolDeps): ToolDef[] {
  const tools: ToolDef[] = [];
  if (deps.memory) tools.push(buildMemoryTool(deps.memory));
  if (deps.notify) tools.push(buildNotifyTool(deps.notify));
  const formatting = channelFormattingTool(deps.channels ?? []);
  if (formatting) tools.push(formatting);
  return tools;
}

function buildMemoryTool(memory: MemoryPort): ToolDef {
  return define({
    name: "recall_memory",
    description:
      "Search durable memory for facts relevant to the current task. Use when the user "
      + "references something from the past, or you need prior context. Returns short previews "
      + "with provenance; not for general web search (use brave/webpage).",
    schema: Schema.Struct({
      query: Schema.String,
      k: Schema.optional(
        Schema.Number.check(
          Schema.isInt(),
          Schema.isLessThanOrEqualTo(MAX_RECALL_RESULTS),
        ),
      ),
    }),
    meta: {
      componentId: "memory",
      bundle: "memory",
      core: true,
      write: false,
    },
    run: async (args) => {
      const origins = ["owner", "internal", "untrusted"] as const;
      return Effect.runPromise(
        memory.recall({
          text: args.query,
          k: args.k ?? DEFAULT_RECALL_RESULTS,
          origins: [...origins],
        }).pipe(
          Effect.match({
            onSuccess: (records) =>
              JSON.stringify(
                records.map((record) => ({
                  origin: record.origin,
                  text: record.preview,
                  score: record.score,
                })),
              ),
            onFailure: (error) => JSON.stringify({ error: error.message }),
          }),
        ),
      );
    },
  });
}

function buildNotifyTool(notify: NotifyPort): ToolDef {
  return define({
    name: "notify",
    description:
      "Send the owner an out-of-band alert via the homelab notify webhook. Use for things that "
      + "warrant a push (a finished long task, a security event), not for the normal chat reply. "
      + "You pass only the message body; the recipient is fixed server-side.",
    schema: Schema.Struct({
      body: Schema.String,
      subject: Schema.optional(Schema.String),
      channels: Schema.optional(Schema.Array(Schema.String)),
    }),
    meta: {
      componentId: "notify",
      bundle: "comms",
      core: true,
      write: false,
    },
    run: async (args) =>
      Effect.runPromise(
        notify
          .send({
            body: args.body,
            ...(args.subject && { subject: args.subject }),
            ...(args.channels && { channels: [...args.channels] }),
          })
          .pipe(
            Effect.match({
              onSuccess: () => JSON.stringify({ sent: true }),
              onFailure: (error) => JSON.stringify({ error: error.message }),
            }),
          ),
      ),
  });
}
