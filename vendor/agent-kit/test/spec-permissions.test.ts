import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { define } from "../src/core/agent/index.js";
import type { ToolDef } from "../src/core/agent/types.js";
import {
  applyPermissions,
  materializedTools,
} from "../src/host/spec/permissions.js";

const tool = (name: string, write = false): ToolDef =>
  define({
    name,
    description: `${name} test tool`,
    schema: Schema.Struct({}),
    meta: { componentId: "t", bundle: "web", core: false, write },
    run: async () => "ok",
  });

describe("applyPermissions (AGENT-SPEC §1.3)", () => {
  const imports = [
    { uses: "browser@red-roster" }, // unlisted → read
    { uses: "youtube@red-roster", with: { approval: "auto" } }, // write, auto
    { uses: "gmail@red-roster" }, // read (listed)
    { uses: "github/draft-pr@red-roster" }, // none
    { uses: "home-assistant@red-roster" }, // write, gated (no approval: auto)
    { uses: "./skills/pakman-latest-episode" }, // local, unlisted → read
  ];
  const permissions = {
    youtube: "write" as const,
    gmail: "read" as const,
    github: "none" as const,
    "home-assistant": "write" as const,
  };

  test("full matrix: read / write / none / unlisted / approval:auto", () => {
    const { decisions } = applyPermissions({ imports, permissions });
    expect(decisions.map((d) => ({
      domain: d.domain,
      level: d.level,
      listed: d.listed,
      approval: d.approval,
      tools: d.materializeTools,
      write: d.materializeWriteTools,
    }))).toEqual([
      {
        domain: "browser",
        level: "read",
        listed: false,
        approval: null,
        tools: true,
        write: false,
      },
      {
        domain: "youtube",
        level: "write",
        listed: true,
        approval: "auto",
        tools: true,
        write: true,
      },
      {
        domain: "gmail",
        level: "read",
        listed: true,
        approval: null,
        tools: true,
        write: false,
      },
      {
        domain: "github",
        level: "none",
        listed: true,
        approval: null,
        tools: false,
        write: false,
      },
      {
        domain: "home-assistant",
        level: "write",
        listed: true,
        approval: "gated",
        tools: true,
        write: true,
      },
      {
        domain: "pakman-latest-episode",
        level: "read",
        listed: false,
        approval: null,
        tools: true,
        write: false,
      },
    ]);
  });

  test("approval: auto without write permission stays read-only", () => {
    const { decisions } = applyPermissions({
      imports: [{ uses: "webpage", with: { approval: "auto" } }],
      permissions: {},
    });
    expect(decisions[0]!.approval).toBeNull();
    expect(decisions[0]!.materializeWriteTools).toBe(false);
  });

  test("summary is serializable and keyed by uses ref", () => {
    const { summary } = applyPermissions({ imports, permissions });
    expect(summary["youtube@red-roster"]).toEqual({
      domain: "youtube",
      level: "write",
      listed: true,
      tools: true,
      writeTools: "auto",
    });
    expect(summary["home-assistant@red-roster"]!.writeTools).toBe("gated");
    expect(summary["browser@red-roster"]!.writeTools).toBe("omitted");
    expect(summary["github/draft-pr@red-roster"]).toEqual({
      domain: "github",
      level: "none",
      listed: true,
      tools: false,
      writeTools: "omitted",
    });
    // JSON round-trip proves serializability.
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  test("no permissions block at all → everything defaults to read", () => {
    const { decisions } = applyPermissions({
      imports: [{ uses: "browser" }],
    });
    expect(decisions[0]!.level).toBe("read");
    expect(decisions[0]!.listed).toBe(false);
  });
});

describe("materializedTools", () => {
  const reads = [tool("x_read")];
  const writes = [tool("x_write", true)];

  test("read → only Active.tools materialize", () => {
    const { decisions } = applyPermissions({ imports: [{ uses: "x" }] });
    const out = materializedTools({
      decision: decisions[0]!,
      tools: reads,
      writeTools: writes,
    });
    expect(out.tools.map((t) => t.name)).toEqual(["x_read"]);
    expect(out.writeTools).toEqual([]);
  });

  test("write → tools + writeTools materialize", () => {
    const { decisions } = applyPermissions({
      imports: [{ uses: "x" }],
      permissions: { x: "write" },
    });
    const out = materializedTools({
      decision: decisions[0]!,
      tools: reads,
      writeTools: writes,
    });
    expect(out.tools.map((t) => t.name)).toEqual(["x_read"]);
    expect(out.writeTools.map((t) => t.name)).toEqual(["x_write"]);
  });

  test("none → nothing materializes", () => {
    const { decisions } = applyPermissions({
      imports: [{ uses: "x" }],
      permissions: { x: "none" },
    });
    const out = materializedTools({
      decision: decisions[0]!,
      tools: reads,
      writeTools: writes,
    });
    expect(out.tools).toEqual([]);
    expect(out.writeTools).toEqual([]);
  });
});
