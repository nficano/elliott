import * as Schema from "effect/Schema";
import { define } from "../../core/agent/index.js";
import type { ToolDef } from "../../core/agent/types.js";
import { JobsSvc, StoreSvc } from "../../core/di/services.js";
import { REMINDER_JOB_KIND } from "../../host/jobs/reminder.js";
import type { JobQueue } from "../../host/jobs/types.js";
import type { Manifest, Registrable } from "../../host/registry/types.js";
import type { StorePort } from "../../store/types.js";
import { ReminderConfig } from "./schema.js";
import type { Cfg } from "./types.js";

export { REMINDER_JOB_KIND } from "../../host/jobs/reminder.js";

/**
 * Reminders skill (§17). "Remind me at 5pm to call the pharmacy" → a durable
 * one-shot job (run_after in Postgres, survives restarts) whose handler delivers
 * via notify. The delivery handler is registered at boot by the framework
 * (`registerReminderHandler`) — a skill activates lazily on first use, too late
 * for a reminder due right after a restart. Disabled by default (§5).
 */
const MS_PER_MINUTE = 60_000;

const META = {
  componentId: "reminders",
  bundle: "ops",
  core: false,
  write: false,
};

const manifest: Manifest<Cfg> = {
  id: "reminders",
  kind: "skill",
  version: "0.1.0",
  configSchema: ReminderConfig,
  bundle: "ops",
  trust: "internal",
  defaultTier: "fast",
  capabilities: ["writes:schedule"],
  contracts: { tools: ["reminder_set", "reminder_list", "reminder_cancel"] },
};

/** Resolve the fire time from `in_minutes` / `at`, or an error to relay back. */
function resolveWhen(
  at: string | undefined,
  inMinutes: number | undefined,
): Date | { error: string; } {
  if (inMinutes) return new Date(Date.now() + inMinutes * MS_PER_MINUTE);
  if (at) {
    const t = Date.parse(at);
    if (Number.isNaN(t)) return { error: `unparseable datetime: ${at}` };
    return new Date(t);
  }
  return { error: "provide `at` or `in_minutes`" };
}

function makeSetTool(getJobs: () => JobQueue, owner: string): ToolDef {
  return define({
    name: "reminder_set",
    description:
      `Set a one-shot reminder for ${owner}. Provide the reminder text and WHEN: either \`at\` as an `
      + "ISO-8601 datetime WITH utc offset (e.g. 2026-07-21T17:00:00-04:00 — compute it from the "
      + "current time in your context) or `in_minutes` from now. Delivered as a notification; "
      + "survives restarts.",
    schema: Schema.Struct({
      text: Schema.String,
      at: Schema.optional(Schema.String),
      // greaterThanOrEqualTo(1), not positive(): positive() emits draft-4
      // boolean exclusiveMinimum, which Anthropic's 2020-12 validator rejects.
      in_minutes: Schema.optional(
        Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
      ),
    }),
    meta: META,
    run: async (a) => {
      const when = resolveWhen(a.at, a.in_minutes);
      if (!(when instanceof Date)) return JSON.stringify(when);
      if (when.getTime() < Date.now() - MS_PER_MINUTE) {
        return JSON.stringify({
          error: `${when.toISOString()} is in the past`,
        });
      }
      const id = await getJobs().enqueue({
        kind: REMINDER_JOB_KIND,
        payload: { text: a.text },
        runAfter: when,
      });
      return JSON.stringify({
        ok: true,
        id,
        fires_at: when.toISOString(),
        text: a.text,
      });
    },
  });
}

function makeListTool(getStore: () => StorePort, owner: string): ToolDef {
  return define({
    name: "reminder_list",
    description: `List ${owner}'s pending reminders (id, text, fire time).`,
    schema: Schema.Struct({}),
    meta: META,
    run: async () => {
      const store = getStore();
      const rows = await store.run(
        store.sql<{ id: string; text: string; run_after: Date; }>`
          SELECT id, payload->>'text' AS text, run_after FROM jobs
          WHERE kind = ${REMINDER_JOB_KIND} AND status = 'ready'
          ORDER BY run_after`,
      );
      return JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          text: r.text,
          fires_at: r.run_after.toISOString(),
        })),
      );
    },
  });
}

function makeCancelTool(getStore: () => StorePort): ToolDef {
  return define({
    name: "reminder_cancel",
    description: "Cancel a pending reminder by id (from reminder_list).",
    schema: Schema.Struct({ id: Schema.String }),
    meta: META,
    run: async (a) => {
      const store = getStore();
      const rows = await store.run(
        store.sql<{ id: string; }>`
          UPDATE jobs SET status = 'dead', last_error = 'cancelled'
          WHERE id = ${a.id} AND kind = ${REMINDER_JOB_KIND}
            AND status = 'ready'
          RETURNING id`,
      );
      return JSON.stringify(
        rows.length > 0
          ? { cancelled: a.id }
          : { error: `no pending reminder ${a.id}` },
      );
    },
  });
}

export function remindersSkill(): Registrable<Cfg> {
  return {
    manifest,
    async activate(ctx) {
      const { owner } = ctx.config;
      return {
        tools: [
          makeSetTool(() => ctx.get(JobsSvc), owner),
          makeListTool(() => ctx.get(StoreSvc), owner),
          makeCancelTool(() => ctx.get(StoreSvc)),
        ],
      };
    },
  };
}

export function remindersPack(): Registrable[] {
  return [remindersSkill()];
}
