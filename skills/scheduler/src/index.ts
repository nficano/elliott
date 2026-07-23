import path from "node:path";
import { isJsonRecord } from "../../../src/providers/http";
import { objectSchema, requiredString } from "../../../src/runtime/skills/http";
import type {
  ServiceBinding,
  SkillContext,
  SkillRegistration,
} from "../../../src/runtime/skills/types";
import type { ToolDefinition } from "../../../src/runtime/types";
import { makeReminderStore } from "./store";
import type { ReminderStore } from "./types";

const TICK_INTERVAL_MILLISECONDS = 30_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MAX_MINUTES_AHEAD = 527_040;

export const register = (context: SkillContext): SkillRegistration => {
  const store = makeReminderStore(
    path.join(context.stateDirectory, "scheduler"),
  );
  return {
    tools: [setTool(store), listTool(store), cancelTool(store)],
    services: [tickService(store, context)],
  };
};

const setTool = (store: ReminderStore): ToolDefinition => ({
  name: "reminder_set",
  description: "Set a one-shot reminder. Provide the reminder text and "
    + "WHEN: either `at` as an ISO-8601 datetime with a UTC offset "
    + "(compute it from the current time in your context) or "
    + "`in_minutes` from now. Delivered as a message; survives restarts.",
  inputSchema: objectSchema({
    text: { type: "string", minLength: 1 },
    at: { type: "string" },
    in_minutes: { type: "integer", minimum: 1, maximum: MAX_MINUTES_AHEAD },
  }, ["text"]),
  execute: async (input) => {
    const when = resolveWhen(input);
    if (when instanceof Date) {
      if (when.getTime() < Date.now() - MILLISECONDS_PER_MINUTE) {
        return JSON.stringify({
          error: `${when.toISOString()} is in the past`,
        });
      }
      const reminder = await store.add(requiredString(input, "text"), when);
      return JSON.stringify({
        ok: true,
        id: reminder.id,
        fires_at: reminder.firesAt,
        text: reminder.text,
      });
    }
    return JSON.stringify(when);
  },
});

const listTool = (store: ReminderStore): ToolDefinition => ({
  name: "reminder_list",
  description: "List pending reminders (id, text, fire time).",
  inputSchema: objectSchema({}, []),
  execute: async () => {
    const reminders = await store.pending();
    return JSON.stringify(reminders.map((item) => ({
      id: item.id,
      text: item.text,
      fires_at: item.firesAt,
    })));
  },
});

const cancelTool = (store: ReminderStore): ToolDefinition => ({
  name: "reminder_cancel",
  description: "Cancel a pending reminder by id (from reminder_list).",
  inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
  execute: async (input) => {
    const id = requiredString(input, "id");
    const cancelled = await store.cancel(id);
    return JSON.stringify(
      cancelled ? { cancelled: id } : { error: `no pending reminder ${id}` },
    );
  },
});

const tickService = (
  store: ReminderStore,
  context: SkillContext,
): ServiceBinding => {
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async (): Promise<void> => {
    const due = (await store.pending()).filter(
      (item) => Date.parse(item.firesAt) <= Date.now(),
    );
    for (const reminder of due) {
      await context.deliver(`⏰ Reminder: ${reminder.text}`);
      await store.markDelivered(reminder.id);
    }
  };
  return {
    name: "scheduler",
    start: () => {
      timer = setInterval(() => {
        tick().catch((error: unknown) =>
          context.report(error, "scheduler:tick")
        );
      }, TICK_INTERVAL_MILLISECONDS);
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
    },
  };
};

const resolveWhen = (input: unknown): Date | { readonly error: string; } => {
  if (isJsonRecord(input) && typeof input["in_minutes"] === "number") {
    return new Date(
      Date.now() + input["in_minutes"] * MILLISECONDS_PER_MINUTE,
    );
  }
  if (isJsonRecord(input) && typeof input["at"] === "string") {
    const time = Date.parse(input["at"]);
    if (Number.isNaN(time)) {
      return { error: `unparseable datetime: ${input["at"]}` };
    }
    return new Date(time);
  }
  return { error: "provide `at` or `in_minutes`" };
};
