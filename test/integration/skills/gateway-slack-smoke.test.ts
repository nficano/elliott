import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  loadOneSkill,
  makeSmokeContext,
  stubFetch,
  toolByName,
} from "./fixtures";

// Tier-1 skill-logic smoke for gateway-slack: the message tool posts through
// the real client (stubbed HTTP), and the gateway registers. Gateway
// connection/socket behavior is unit-tested directly against SlackGateway in
// skills/gateway-slack/evals/. See docs/explanation/testing-strategy.md.

afterEach(() => {
  mock.restore();
});

describe("gateway-slack skill logic (Tier 1)", () => {
  it("stays dormant without slack settings", async () => {
    const { context } = await makeSmokeContext({ slack: undefined });
    const registration = await loadOneSkill("gateway-slack", context);
    expect(registration.tools ?? []).toHaveLength(0);
    expect(registration.gateways ?? []).toHaveLength(0);
  });

  it("registers a SlackGateway and posts a message through the real client", async () => {
    const stub = stubFetch([{
      match: "slack.com/api/chat.postMessage",
      body: JSON.stringify({ ok: true, ts: "1.1" }),
    }]);
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("gateway-slack", context);
    expect(registration.gateways).toHaveLength(1);
    expect(registration.gateways?.[0]?.name).toBe("gateway-slack");

    const tool = toolByName(registration, "slack_message");
    const result = JSON.parse(
      await tool.execute({
        text: "hello",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "hello" } }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(stub.calls[0]).toContain("chat.postMessage");
  });
});
