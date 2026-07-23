import * as Effect from "effect/Effect";
import type { NotifyPort } from "../../core/notify/types.js";
import type { Job, JobQueue } from "./types.js";

/**
 * Reminders (§17). "Remind me at 5pm to call the pharmacy" enqueues a durable
 * one-shot job (`run_after` in Postgres, survives restarts); this handler
 * delivers it via notify when it fires. The `reminder_set/list/cancel` tools
 * that enqueue and manage these jobs live in the `skills/reminders` pack.
 */
export const REMINDER_JOB_KIND = "reminder";

/**
 * Register the reminder delivery handler eagerly at boot (§14) — BEFORE the
 * worker starts, so a reminder due right after a restart finds its handler even
 * though the skill itself activates lazily on first use. A failed send fails the
 * job → retried. No-op when notify isn't configured (nothing could deliver).
 */
export function registerReminderHandler(
  jobs: JobQueue,
  notify: NotifyPort | undefined,
): void {
  if (!notify) return;
  jobs.handle(REMINDER_JOB_KIND, async (job: Job) => {
    const text = (job.payload as { text?: string; }).text ?? "";
    // Map the notify error so `runPromise` rejects → the job fails → retried.
    await Effect.runPromise(
      notify
        .send({ body: `⏰ Reminder: ${text}` })
        .pipe(
          Effect.mapError((e) =>
            new Error(`reminder notify failed: ${e.message}`)
          ),
        ),
    );
  });
}
