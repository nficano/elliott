import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Reminder, ReminderStore } from "./types";

export const makeReminderStore = (directory: string): ReminderStore => {
  const file = path.join(directory, "reminders.json");
  const serialize = makeSerializer();
  return {
    pending: () =>
      serialize(async () =>
        (await load(file)).filter((item) => item.status === "pending")
      ),
    add: (text, firesAt) => serialize(() => addReminder(file, text, firesAt)),
    cancel: (id) => serialize(() => cancelReminder(file, id)),
    markDelivered: (id) =>
      serialize(() => transition(file, id, "delivered").then(() => undefined)),
  };
};

const makeSerializer = (): <T>(work: () => Promise<T>) => Promise<T> => {
  let queue: Promise<unknown> = Promise.resolve();
  return (work) => {
    const next = queue.catch(() => undefined).then(work);
    queue = next.catch(() => undefined);
    return next;
  };
};

const addReminder = async (
  file: string,
  text: string,
  firesAt: Date,
): Promise<Reminder> => {
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    text,
    firesAt: firesAt.toISOString(),
    status: "pending",
  };
  await save(file, [...(await load(file)), reminder]);
  return reminder;
};

const cancelReminder = async (file: string, id: string): Promise<boolean> => {
  const reminders = await load(file);
  const pending = reminders.some(
    (item) => item.id === id && item.status === "pending",
  );
  if (!pending) return false;
  return transition(file, id, "cancelled");
};

const transition = async (
  file: string,
  id: string,
  status: Reminder["status"],
): Promise<boolean> => {
  const reminders = await load(file);
  await save(
    file,
    reminders.map((item) => (item.id === id ? { ...item, status } : item)),
  );
  return true;
};

const load = async (file: string): Promise<readonly Reminder[]> => {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isReminder) : [];
  } catch {
    return [];
  }
};

const save = async (
  file: string,
  reminders: readonly Reminder[],
): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const scratch = `${file}.tmp`;
  await writeFile(scratch, JSON.stringify(reminders, undefined, 2), "utf8");
  await rename(scratch, file);
};

const isReminder = (value: unknown): value is Reminder => {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item["id"] === "string"
    && typeof item["text"] === "string"
    && typeof item["firesAt"] === "string"
    && (item["status"] === "pending" || item["status"] === "delivered"
      || item["status"] === "cancelled");
};
