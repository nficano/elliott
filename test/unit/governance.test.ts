import { describe, expect, it } from "bun:test";
import { AuditLog, MemoryCommitAdapter } from "../../src/audit/index";
import type { RecordEvent } from "../../src/core/waist/types";
import {
  GovernanceDeniedError,
  GovernancePolicy,
  makeGovernanceControlPlane,
  ToolGovernor,
} from "../../src/runtime/governance/index";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_METHOD_NOT_ALLOWED = 405;

// Minimal ToolDefinition-shaped tool whose execute echoes/flags what happened.
const makeTool = (
  name: string,
  run: (input: unknown) => Promise<string>,
) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object" },
  execute: (input: unknown) => run(input),
});

// A record sink that always fails, to prove audit-write failures are non-fatal
// for allowed calls yet never soften a denial.
class ThrowingAppender {
  append(): Promise<RecordEvent> {
    return Promise.reject(new Error("audit sink offline"));
  }
}

const records = (log: AuditLog): readonly RecordEvent[] =>
  Object.values(log.snapshot().shards).flat();

const ofType = (log: AuditLog, type: string): readonly RecordEvent[] =>
  records(log).filter((record) => record.type === type);

const newGovernor = (
  log: AuditLog,
  deny: readonly string[] = [],
): ToolGovernor =>
  new ToolGovernor({
    agent: "elliott",
    records: log,
    policy: new GovernancePolicy({ deny }),
  });

const controlRequest = (init: RequestInit): Request =>
  new Request("http://runtime/v1/control/governance", init);

describe("ToolGovernor", () => {
  it("audits an allowed call with identity and digests only", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const tool = newGovernor(log).guard(
      makeTool(
        "weather",
        (input) => Promise.resolve(`echo:${JSON.stringify(input)}`),
      ),
    );
    const result = await tool.execute({ city: "Springfield" }, {
      principal: {
        agent: "elliott",
        actor: "U123",
        gateway: "slack",
        channel: "C1",
      },
    });
    expect(result).toBe(`echo:{"city":"Springfield"}`);
    const invocations = ofType(log, "tool.invocation");
    expect(invocations).toHaveLength(1);
    const payload = invocations[0]?.payload ?? {};
    expect(payload["tool"]).toBe("weather");
    expect(payload["agent"]).toBe("elliott");
    expect(payload["actor"]).toBe("U123");
    expect(payload["effect"]).toBe("allow");
    expect(payload["argumentsDigest"]).toBeString();
    // The raw argument is never persisted — digests only.
    expect(JSON.stringify(payload)).not.toContain("Springfield");
    expect(ofType(log, "tool.result")).toHaveLength(1);
  });

  it("refuses a policy-denied tool without executing it", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    let ran = false;
    const tool = newGovernor(log, ["danger"]).guard(
      makeTool("danger", () => {
        ran = true;
        return Promise.resolve("ran");
      }),
    );
    await expect(tool.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
    expect(ran).toBe(false);
    expect(ofType(log, "tool.invocation")[0]?.payload["effect"]).toBe("deny");
    expect(ofType(log, "tool.result")).toHaveLength(0);
  });

  it("disables and re-enables a tool at runtime", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const governor = newGovernor(log);
    const tool = governor.guard(makeTool("ssh", () => Promise.resolve("ran")));
    expect(await tool.execute({}, undefined)).toBe("ran");
    await governor.disable("ssh", "operator");
    expect(governor.status().disabled).toContain("ssh");
    await expect(tool.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
    await governor.enable("ssh", "operator");
    expect(await tool.execute({}, undefined)).toBe("ran");
    expect(ofType(log, "governance.tool-disabled")).toHaveLength(1);
  });

  it("freezes and unfreezes every tool", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const governor = newGovernor(log);
    const first = governor.guard(makeTool("a", () => Promise.resolve("a")));
    const second = governor.guard(makeTool("b", () => Promise.resolve("b")));
    await governor.freeze("operator");
    expect(governor.status().frozen).toBe(true);
    await expect(first.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
    await expect(second.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
    await governor.unfreeze("operator");
    expect(await first.execute({}, undefined)).toBe("a");
  });

  it("keeps allowed execution alive when the audit sink fails", async () => {
    const reported: string[] = [];
    const governor = new ToolGovernor({
      agent: "elliott",
      records: new ThrowingAppender(),
      policy: new GovernancePolicy(),
      report: (_error, mechanism) => reported.push(mechanism),
    });
    const tool = governor.guard(makeTool("ok", () => Promise.resolve("done")));
    expect(await tool.execute({}, undefined)).toBe("done");
    expect(reported).toContain("governance-audit");
  });

  it("still denies when the audit sink fails", async () => {
    const governor = new ToolGovernor({
      agent: "elliott",
      records: new ThrowingAppender(),
      policy: new GovernancePolicy({ deny: ["x"] }),
    });
    const tool = governor.guard(makeTool("x", () => Promise.resolve("nope")));
    await expect(tool.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
  });
});

describe("governance control plane", () => {
  it("rejects a request without a valid bearer token", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const plane = makeGovernanceControlPlane(newGovernor(log), "s3cret");
    const res = await plane.handle(controlRequest({ method: "GET" }));
    expect(res.status).toBe(HTTP_UNAUTHORIZED);
  });

  it("returns status for an authorized GET", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const plane = makeGovernanceControlPlane(newGovernor(log, ["x"]), "s3cret");
    const res = await plane.handle(
      controlRequest({
        method: "GET",
        headers: { authorization: "Bearer s3cret" },
      }),
    );
    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body.frozen).toBe(false);
    expect(body.denied).toContain("x");
  });

  it("disables a tool through the control plane", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const governor = newGovernor(log);
    const plane = makeGovernanceControlPlane(governor, "s3cret");
    const tool = governor.guard(
      makeTool("pihole", () => Promise.resolve("ok")),
    );
    const res = await plane.handle(
      controlRequest({
        method: "POST",
        headers: {
          authorization: "Bearer s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "disable", tool: "pihole" }),
      }),
    );
    expect(res.status).toBe(HTTP_OK);
    await expect(tool.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
  });

  it("rejects an unknown operation with 400", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const plane = makeGovernanceControlPlane(newGovernor(log), "s3cret");
    const res = await plane.handle(
      controlRequest({
        method: "POST",
        headers: {
          authorization: "Bearer s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "nuke" }),
      }),
    );
    expect(res.status).toBe(HTTP_BAD_REQUEST);
  });

  it("rejects an unsupported method with 405", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const plane = makeGovernanceControlPlane(newGovernor(log), "s3cret");
    const res = await plane.handle(
      controlRequest({
        method: "PUT",
        headers: { authorization: "Bearer s3cret" },
      }),
    );
    expect(res.status).toBe(HTTP_METHOD_NOT_ALLOWED);
  });
});
