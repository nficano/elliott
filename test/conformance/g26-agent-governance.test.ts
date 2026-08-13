import { describe, expect, it } from "bun:test";
import { AuditLog, MemoryCommitAdapter } from "../../src/audit/index";
import type { RecordEvent } from "../../src/core/waist/types";
import {
  GovernanceDeniedError,
  GovernancePolicy,
  makeGovernanceControlPlane,
  ToolGovernor,
} from "../../src/runtime/governance/index";

// G26 — runtime tool governance. Adapts the Agent Governance Toolkit's OWASP
// Agentic Top-10 control set to elliott's live tool path: every model-issued
// tool call is intercepted in deterministic code, attributed to a principal,
// audited to the tamper-evident log, and subject to a runtime kill switch. This
// is the executable checklist for that adoption (docs/explanation/governance.md).

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

const tool = (name: string, run: (input: unknown) => Promise<string>) => ({
  name,
  description: name,
  inputSchema: { type: "object" },
  execute: (input: unknown) => run(input),
});

const ofType = (log: AuditLog, type: string): readonly RecordEvent[] =>
  Object.values(log.snapshot().shards).flat().filter((r) => r.type === type);

const governorOver = (
  log: AuditLog,
  deny: readonly string[] = [],
): ToolGovernor =>
  new ToolGovernor({
    agent: "elliott",
    records: log,
    policy: new GovernancePolicy({ deny }),
  });

describe("G26 agent governance", () => {
  // Excessive Agency / Tool Misuse: a forbidden action is refused in code, not
  // left to the model's discretion.
  it("deterministically refuses a denied tool", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    let executed = false;
    const guarded = governorOver(log, ["shell"]).guard(
      tool("shell", () => {
        executed = true;
        return Promise.resolve("ran");
      }),
    );
    await expect(guarded.execute({ cmd: "rm -rf /" }, undefined)).rejects
      .toBeInstanceOf(GovernanceDeniedError);
    expect(executed).toBe(false);
  });

  // Identity & attribution: the acting agent and human actor are bound to the
  // call so a shared gateway's actions are traceable per-agent.
  it("attributes every call to a principal", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const guarded = governorOver(log).guard(
      tool("noop", () => Promise.resolve("ok")),
    );
    await guarded.execute({}, {
      principal: { agent: "agent-a", actor: "U9", gateway: "slack" },
    });
    const payload = ofType(log, "tool.invocation")[0]?.payload ?? {};
    expect(payload["agent"]).toBe("agent-a");
    expect(payload["actor"]).toBe("U9");
  });

  // Sensitive information disclosure: arguments and results are digested, never
  // stored as plaintext in the trail.
  it("records digests, never raw arguments", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const guarded = governorOver(log).guard(
      tool("secretish", () => Promise.resolve("result-body")),
    );
    await guarded.execute({ token: "hunter2" }, undefined);
    const dump = JSON.stringify(Object.values(log.snapshot().shards).flat());
    expect(dump).not.toContain("hunter2");
    expect(dump).not.toContain("result-body");
    expect(ofType(log, "tool.invocation")[0]?.payload["argumentsDigest"])
      .toBeString();
  });

  // Insufficient logging / repudiation: the trail is tamper-evident — mutating a
  // committed record is detected on verification.
  it("keeps a tamper-evident trail of tool activity", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const guarded = governorOver(log).guard(
      tool("read", () => Promise.resolve("ok")),
    );
    await guarded.execute({}, undefined);
    const clean = log.snapshot();
    expect(AuditLog.verify(clean).valid).toBe(true);
    const key = Object.keys(clean.shards)[0] ?? "";
    const mutated = (clean.shards[key] ?? []).map((record, index) =>
      index === 0 ? { ...record, payload: { forged: true } } : record
    );
    expect(
      AuditLog.verify({
        shards: { [key]: mutated },
        crossLinks: clean.crossLinks,
      }).valid,
    ).toBe(false);
  });

  // Runtime control / Agent SRE: a live tool can be halted without a restart,
  // and only an authenticated operator may flip the switch.
  it("halts a tool at runtime only for an authenticated operator", async () => {
    const log = new AuditLog(new MemoryCommitAdapter());
    const governor = governorOver(log);
    const guarded = governor.guard(tool("pihole", () => Promise.resolve("ok")));
    const plane = makeGovernanceControlPlane(governor, "s3cret");

    const unauthorized = await plane.handle(
      new Request("http://runtime/v1/control/governance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "disable", tool: "pihole" }),
      }),
    );
    expect(unauthorized.status).toBe(HTTP_UNAUTHORIZED);
    expect(await guarded.execute({}, undefined)).toBe("ok");

    const authorized = await plane.handle(
      new Request("http://runtime/v1/control/governance", {
        method: "POST",
        headers: {
          authorization: "Bearer s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ op: "disable", tool: "pihole" }),
      }),
    );
    expect(authorized.status).toBe(HTTP_OK);
    await expect(guarded.execute({}, undefined)).rejects.toBeInstanceOf(
      GovernanceDeniedError,
    );
  });
});
