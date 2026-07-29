import { describe, expect, it } from "bun:test";
import { AuditLog, MemoryCommitAdapter } from "../../src/audit/index";
import { EpochRegistry } from "../../src/core/epoch/epochs";
import type { RecordEvent } from "../../src/core/waist/types";
import {
  CapabilityGate,
  GovernancePolicy,
  ToolGovernor,
} from "../../src/runtime/governance/index";
import { CapabilityBroker } from "../../src/security/broker/broker";
import { GrantManager } from "../../src/security/grants/manager";
import { OpaqueSecretStore } from "../../src/security/secrets/secrets";

const HOSTS = ["spruce", "root@pve"];

const sshTool = (onRun: (host: string) => void) => ({
  name: "ssh_exec",
  description: "ssh",
  inputSchema: { type: "object" },
  execute: (input: unknown) => {
    const host = (input as { host: string; }).host;
    onRun(host);
    return Promise.resolve(`ran:${host}`);
  },
});

const setup = () => {
  const log = new AuditLog(new MemoryCommitAdapter());
  const grants = new GrantManager(new EpochRegistry(log));
  const broker = new CapabilityBroker(grants, log, new OpaqueSecretStore());
  const gate = new CapabilityGate({ broker, grants, agent: "elliott" }, {
    tool: "ssh_exec",
    capability: "ssh.exec",
    resources: HOSTS,
    resolveResource: (input) => (input as { host: string; }).host,
  });
  return { log, gate };
};

const types = (log: AuditLog): readonly string[] =>
  Object.values(log.snapshot().shards).flat().map((r: RecordEvent) => r.type);

describe("CapabilityGate (SSH through the broker)", () => {
  it("runs an allowlisted host and records broker dispatch/result", async () => {
    const { log, gate } = setup();
    const gated = gate.apply(sshTool(() => undefined));
    const out = await gated.execute({ host: "spruce", command: "uptime" });
    expect(out).toBe("ran:spruce");
    expect(types(log)).toContain("broker.dispatch");
    expect(types(log)).toContain("broker.result");
  });

  it("allows a user-qualified allowlist entry", async () => {
    const { gate } = setup();
    const gated = gate.apply(sshTool(() => undefined));
    expect(await gated.execute({ host: "root@pve", command: "id" })).toBe(
      "ran:root@pve",
    );
  });

  it("denies a host outside the grant before the tool runs", async () => {
    const { log, gate } = setup();
    let ran = 0;
    const gated = gate.apply(sshTool(() => {
      ran += 1;
    }));
    await expect(gated.execute({ host: "evil.example", command: "x" })).rejects
      .toThrow("Capability denied");
    expect(ran).toBe(0);
    // Denial happens at materialization, before any dispatch record is written.
    expect(types(log)).not.toContain("broker.dispatch");
  });

  it("leaves non-matching tools untouched", () => {
    const { gate } = setup();
    const other = {
      name: "weather",
      description: "w",
      inputSchema: {},
      execute: () => Promise.resolve("ok"),
    };
    expect(gate.apply(other)).toBe(other);
  });

  it("composes under the governor into one layered audit trail", async () => {
    const { log, gate } = setup();
    const governor = new ToolGovernor({
      agent: "elliott",
      records: log,
      policy: new GovernancePolicy(),
    });
    const composed = governor.decorate(
      gate.decorate([sshTool(() => undefined)]),
    );
    await composed[0]?.execute({ host: "spruce", command: "x" }, {
      principal: { agent: "elliott", actor: "U1" },
    });
    const recorded = types(log);
    expect(recorded).toContain("tool.invocation");
    expect(recorded).toContain("broker.dispatch");
    expect(recorded).toContain("broker.result");
    expect(recorded).toContain("tool.result");
  });
});
