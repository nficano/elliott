import { describe, expect, it } from "bun:test";
import { makeGovernanceControlPlane } from "../../src/runtime/governance/control-plane";
import { parseGovernanceOperation } from "../../src/runtime/governance/control-plane";
import type { ToolGovernor } from "../../src/runtime/governance/governor";
import type { GovernanceStatus } from "../../src/runtime/governance/types";

describe("parseGovernanceOperation", () => {
  it("rejects a non-record body with the request-body message", () => {
    for (const body of [null, undefined, 5, "freeze", ["freeze"]]) {
      expect(parseGovernanceOperation(body)).toEqual({
        kind: "invalid",
        reason: "Invalid request body",
      });
    }
  });

  it("parses freeze", () => {
    expect(parseGovernanceOperation({ op: "freeze" })).toEqual({
      kind: "freeze",
    });
  });

  it("parses unfreeze", () => {
    expect(parseGovernanceOperation({ op: "unfreeze" })).toEqual({
      kind: "unfreeze",
    });
  });

  it("parses disable with a tool", () => {
    expect(parseGovernanceOperation({ op: "disable", tool: "ssh_exec" }))
      .toEqual({ kind: "disable", tool: "ssh_exec" });
  });

  it("parses enable with a tool", () => {
    expect(parseGovernanceOperation({ op: "enable", tool: "ssh_exec" }))
      .toEqual({ kind: "enable", tool: "ssh_exec" });
  });

  it("rejects disable without a tool as an invalid operation", () => {
    expect(parseGovernanceOperation({ op: "disable" })).toEqual({
      kind: "invalid",
      reason: "Invalid governance operation",
    });
  });

  it("rejects a non-string tool", () => {
    expect(parseGovernanceOperation({ op: "enable", tool: 42 })).toEqual({
      kind: "invalid",
      reason: "Invalid governance operation",
    });
  });

  it("rejects an unknown op", () => {
    expect(parseGovernanceOperation({ op: "nuke" })).toEqual({
      kind: "invalid",
      reason: "Invalid governance operation",
    });
  });

  it("rejects a body with a tool but no op", () => {
    expect(parseGovernanceOperation({ tool: "ssh_exec" })).toEqual({
      kind: "invalid",
      reason: "Invalid governance operation",
    });
  });
});

// End-to-end proof that the shell rewire preserved status codes + strings.
const fakeGovernor = () => {
  const calls: string[] = [];
  const status: GovernanceStatus = {
    frozen: false,
    disabled: [],
    denied: [],
  };
  const governor = {
    status: () => status,
    freeze: async () => {
      calls.push("freeze");
    },
    unfreeze: async () => {
      calls.push("unfreeze");
    },
    disable: async (tool: string) => {
      calls.push(`disable:${tool}`);
    },
    enable: async (tool: string) => {
      calls.push(`enable:${tool}`);
    },
  } as unknown as ToolGovernor;
  return { governor, calls };
};

const post = (body: string): Request =>
  new Request("http://x/v1/control/governance", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body,
  });

describe("makeGovernanceControlPlane (rewire behavior)", () => {
  it("applies a disable operation and returns 200 status", async () => {
    const { governor, calls } = fakeGovernor();
    const plane = makeGovernanceControlPlane(governor, "t");
    const response = await plane.handle(
      post(JSON.stringify({ op: "disable", tool: "ssh_exec" })),
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual(["disable:ssh_exec"]);
  });

  it("returns 400 + 'Invalid governance operation' for a bad op", async () => {
    const { governor } = fakeGovernor();
    const plane = makeGovernanceControlPlane(governor, "t");
    const response = await plane.handle(post(JSON.stringify({ op: "nuke" })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid governance operation",
    });
  });

  it("returns 400 + 'Invalid request body' for malformed JSON", async () => {
    const { governor } = fakeGovernor();
    const plane = makeGovernanceControlPlane(governor, "t");
    const response = await plane.handle(post("{not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
  });

  it("returns 400 + 'Invalid request body' for a non-record body", async () => {
    const { governor } = fakeGovernor();
    const plane = makeGovernanceControlPlane(governor, "t");
    const response = await plane.handle(post(JSON.stringify(5)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request body" });
  });
});
