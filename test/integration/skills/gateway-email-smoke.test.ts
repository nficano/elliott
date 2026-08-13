import { describe, expect, it } from "bun:test";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

// Tier-1 skill-logic smoke for gateway-email. The allowlist check is free
// (rejects before any SMTP connection); the wire protocol itself needs a real
// TLS socket and is exercised indirectly through this contract. See
// docs/explanation/testing-strategy.md.

describe("gateway-email skill logic (Tier 1)", () => {
  it("stays dormant without smtp settings", async () => {
    const { context } = await makeSmokeContext({ smtp: undefined });
    const registration = await loadOneSkill("gateway-email", context);
    expect(registration.tools ?? []).toHaveLength(0);
  });

  it("rejects a recipient that is not on the sender allowlist", async () => {
    const { context } = await makeSmokeContext();
    const tool = toolByName(
      await loadOneSkill("gateway-email", context),
      "email_send",
    );
    await expect(
      tool.execute({
        to: "stranger@example.com",
        subject: "hi",
        body: "hello",
      }),
    ).rejects.toThrow(/allowlist/);
  });
});
