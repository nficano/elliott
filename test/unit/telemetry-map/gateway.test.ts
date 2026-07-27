import { describe, expect, it } from "bun:test";
import { TelemetryMapGateway } from "../../../skills/telemetry-map/src/gateway";
import type { InboundMessage } from "../../../src/runtime/types";

const CHANNEL = "telemetry-map:interactive";

const inbound = (channel = CHANNEL): InboundMessage => ({
  id: "message-1",
  gateway: "telemetry-map",
  channel,
  sender: "map-observer",
  text: "hello",
});

describe("TelemetryMapGateway identity", () => {
  it("registers under the name telemetry-map so replies route back to it", () => {
    expect(new TelemetryMapGateway().name).toBe("telemetry-map");
  });

  it("always reports an active status", () => {
    expect(new TelemetryMapGateway().status()).toBe("active");
  });

  it("start, stop, and send are safe no-ops", async () => {
    const gateway = new TelemetryMapGateway();
    await gateway.start({
      onMessage: async () => {},
      onFeedback: async () => {},
      onError: () => {},
    });
    await gateway.send(CHANNEL, "ignored");
    expect(() => {
      gateway.stop();
    }).not.toThrow();
  });
});

describe("TelemetryMapGateway response capture", () => {
  it("invokes fire after registering the pending channel", async () => {
    const gateway = new TelemetryMapGateway();
    let fired = false;
    const answer = gateway.captureResponse(CHANNEL, () => {
      fired = true;
    });
    expect(fired).toBe(true);
    const response = await gateway.beginResponse(inbound());
    await response.complete("the answer");
    expect(await answer).toBe("the answer");
  });

  it("resolves the captured promise when the agent completes", async () => {
    const gateway = new TelemetryMapGateway();
    const answer = gateway.captureResponse(CHANNEL, () => {});
    const response = await gateway.beginResponse(inbound());
    await response.complete("done");
    expect(await answer).toBe("done");
  });

  it("resolves the captured promise with the failure message on fail", async () => {
    const gateway = new TelemetryMapGateway();
    const answer = gateway.captureResponse(CHANNEL, () => {});
    const response = await gateway.beginResponse(inbound());
    await response.fail("it broke");
    expect(await answer).toBe("it broke");
  });

  it("resolves only once even if complete and fail are both called", async () => {
    const gateway = new TelemetryMapGateway();
    const answer = gateway.captureResponse(CHANNEL, () => {});
    const response = await gateway.beginResponse(inbound());
    await response.complete("first");
    await response.fail("second");
    expect(await answer).toBe("first");
  });

  it("scopes pending responses by channel", async () => {
    const gateway = new TelemetryMapGateway();
    const answerA = gateway.captureResponse("channel-a", () => {});
    const answerB = gateway.captureResponse("channel-b", () => {});
    const responseB = await gateway.beginResponse(inbound("channel-b"));
    await responseB.complete("for b");
    expect(await answerB).toBe("for b");
    const responseA = await gateway.beginResponse(inbound("channel-a"));
    await responseA.complete("for a");
    expect(await answerA).toBe("for a");
  });

  it("tolerates a response for a channel with no pending capture", async () => {
    const gateway = new TelemetryMapGateway();
    const response = await gateway.beginResponse(inbound("unknown"));
    await response.complete("nobody is waiting");
    await response.fail("still nobody");
  });
});
