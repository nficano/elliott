import { describe, expect, it } from "bun:test";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

// Tier-1 skill-logic smoke for the scheduler (tools + a background service).
// The reminder store is real (backed by the fixture's mkdtemp stateDirectory),
// so the set/list/cancel round-trip and the validation error paths run for
// real; the service is checked for a clean start/stop lifecycle. See
// docs/contributing/skill-e2e-smoke-strategy.md.

describe("scheduler tool logic (Tier 1)", () => {
  it("sets, lists, and cancels a reminder against the real store", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("scheduler", context);
    const set = toolByName(registration, "reminder_set");
    const list = toolByName(registration, "reminder_list");
    const cancel = toolByName(registration, "reminder_cancel");

    const created = JSON.parse(
      await set.execute({ text: "stand up", in_minutes: 5 }),
    );
    expect(created.ok).toBe(true);
    expect(typeof created.id).toBe("string");
    expect(created.text).toBe("stand up");

    const pending = JSON.parse(await list.execute({}));
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(created.id);

    const cancelled = JSON.parse(await cancel.execute({ id: created.id }));
    expect(cancelled.cancelled).toBe(created.id);

    expect(JSON.parse(await list.execute({}))).toEqual([]);
  });

  it("rejects a past time and an unparseable datetime", async () => {
    const { context } = await makeSmokeContext();
    const set = toolByName(
      await loadOneSkill("scheduler", context),
      "reminder_set",
    );

    const past = JSON.parse(
      await set.execute({ text: "late", at: "2000-01-01T00:00:00Z" }),
    );
    expect(past.error).toContain("past");

    const garbage = JSON.parse(
      await set.execute({ text: "?", at: "not-a-date" }),
    );
    expect(garbage.error).toContain("unparseable");
  });

  it("starts and stops the tick service cleanly", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("scheduler", context);
    const service = registration.services?.[0];
    if (service === undefined) {
      throw new Error("scheduler service not registered");
    }

    expect(service.name).toBe("scheduler");
    await service.start();
    await service.stop();
  });
});
