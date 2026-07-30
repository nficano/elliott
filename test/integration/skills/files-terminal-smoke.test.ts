import { describe, expect, it } from "bun:test";
import { loadOneSkill, makeSmokeContext, toolByName } from "./fixtures";

// Tier-1 skill-logic smoke for the filesystem-backed tools. These need no stub:
// the fixture points files/terminal at a fresh mkdtemp root, so we run them for
// real and assert both a happy path and the path/allowlist containment that is
// the whole point of these tools. See docs/contributing/skill-e2e-smoke-strategy.md.

describe("files skill logic (Tier 1)", () => {
  it("writes, reads back, and lists a workspace file", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("files", context);
    const write = toolByName(registration, "file_write");
    const read = toolByName(registration, "file_read");
    const list = toolByName(registration, "file_list");

    const written = JSON.parse(
      await write.execute({ path: "notes/hello.txt", content: "hi there" }),
    );
    expect(written.ok).toBe(true);
    expect(written.bytes).toBe(8);

    const readBack = JSON.parse(
      await read.execute({ path: "notes/hello.txt" }),
    );
    expect(readBack.text).toBe("hi there");
    expect(readBack.truncated).toBe(false);

    const listing = JSON.parse(await list.execute({ path: "notes" }));
    expect(listing).toContainEqual({ name: "hello.txt", kind: "file" });
  });

  it("rejects a path that escapes the workspace root", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("files", context);
    const read = toolByName(registration, "file_read");
    await expect(read.execute({ path: "../../etc/passwd" })).rejects.toThrow();
  });
});

describe("terminal skill logic (Tier 1)", () => {
  it("runs an allowlisted command and returns stdout + exit code", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("terminal", context);
    const run = toolByName(registration, "terminal_run");

    const result = JSON.parse(
      await run.execute({ command: "echo", args: ["ping"] }),
    );
    expect(result.exitCode).toBe(0);
    expect(String(result.stdout).trim()).toBe("ping");
  });

  it("rejects a command that is not on the allowlist", async () => {
    const { context } = await makeSmokeContext();
    const registration = await loadOneSkill("terminal", context);
    const run = toolByName(registration, "terminal_run");
    await expect(run.execute({ command: "rm", args: ["-rf", "/"] }))
      .rejects.toThrow(/allowlist/);
  });
});
