/**
 * skills/reminders (§17) — durable one-shot "remind me at …" reminders over the
 * job queue. The `reminder_set/list/cancel` tools enqueue and manage jobs; the
 * framework registers the delivery handler at boot (`registerReminderHandler`).
 * Disabled by default (§5).
 */
export { REMINDER_JOB_KIND, remindersPack, remindersSkill } from "./skills.js";
export type { Cfg } from "./types.js";
