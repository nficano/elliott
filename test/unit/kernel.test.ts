// Placeholder until real suites exist — keeps `bun test` green.
import { describe, expect, it } from "bun:test";
import { AgentKernel } from "../../src/kernel";

describe("AgentKernel", () => {
  it("starts once and refuses a second start", async () => {
    const kernel = new AgentKernel();
    await kernel.start();
    await expect(kernel.start()).rejects.toThrow("already started");
    await kernel.stop();
  });
});
