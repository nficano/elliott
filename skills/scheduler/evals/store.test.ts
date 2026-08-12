import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeReminderStore } from "../src/store";

const roots: string[] = [];

afterEach(async () => {
  const pending = [...roots];
  roots.length = 0;
  await Promise.all(
    pending.map((root) => rm(root, { recursive: true })),
  );
});

describe("scheduler reminder store", () => {
  it("persists and cancels a pending reminder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-reminders-"));
    roots.push(root);
    const first = makeReminderStore(root);
    const reminder = await first.add("review release", new Date(1));
    const second = makeReminderStore(root);
    expect(await second.pending()).toEqual([reminder]);
    expect(await second.cancel(reminder.id)).toBeTrue();
    expect(await first.pending()).toEqual([]);
  });
});
