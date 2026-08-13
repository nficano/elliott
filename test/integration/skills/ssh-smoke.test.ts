import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Readable } from "node:stream";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

// Tier-1 skill-logic smoke for ssh. Allowlist rejection is free; the happy path
// stubs Bun.spawn so we never open a real SSH session. See
// docs/explanation/testing-strategy.md.

afterEach(() => {
  mock.restore();
});

const fakeSpawn = (
  stdout: string,
  stderr: string,
  exitCode: number,
): typeof Bun.spawn => {
  const impl = (() => {
    const stdoutStream = Readable.toWeb(Readable.from([stdout]));
    const stderrStream = Readable.toWeb(Readable.from([stderr]));
    return {
      stdout: stdoutStream,
      stderr: stderrStream,
      exited: Promise.resolve(exitCode),
      kill: () => undefined,
    };
  }) as unknown as typeof Bun.spawn;
  return impl;
};

describe("ssh skill logic (Tier 1)", () => {
  it("rejects a host that is not on the allowlist", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("ssh", context);
    const exec = toolByName(registration, "ssh_exec");
    await expect(
      exec.execute({ host: "evil.example", command: "uname" }),
    ).rejects.toThrow(/allowlist/);
  });

  it("materializes the key and runs against an allowlisted host", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(
      fakeSpawn("ok\n", "", 0),
    );
    const { context } = await makeSmokeContext({
      ssh: {
        user: "agent",
        hosts: ["localhost", "root@db-01"],
        privateKey: "-----BEGIN-----\nk\n-----END-----",
      },
    });
    const registration = await loadOneSkill("ssh", context);
    const exec = toolByName(registration, "ssh_exec");
    const result = JSON.parse(
      await exec.execute({ host: "localhost", command: "uname -a" }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
    expect(spawn).toHaveBeenCalled();
    const args = spawn.mock.calls[0]?.[0] as string[];
    expect(args[0]).toBe("ssh");
    expect(args).toContain("agent@localhost");
    expect(args).toContain("uname -a");
  });

  it("honors user@host allowlist entries as the destination", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(
      fakeSpawn("", "warn", 1),
    );
    const { context } = await makeSmokeContext({
      ssh: {
        user: "agent",
        hosts: ["root@db-01"],
        privateKey: "key-without-newline",
      },
    });
    const registration = await loadOneSkill("ssh", context);
    const exec = toolByName(registration, "ssh_exec");
    const result = JSON.parse(
      await exec.execute({ host: "root@db-01", command: "id" }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("warn");
    const args = spawn.mock.calls[0]?.[0] as string[];
    expect(args).toContain("root@db-01");
    expect(args).not.toContain("agent@root@db-01");
  });
});
