import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { define } from "../src/core/agent/index.js";
import type { ToolDef } from "../src/core/agent/types.js";
import { applyPermissions } from "../src/host/spec/permissions.js";
import { parseUses } from "../src/host/spec/refs.js";
import {
  buildToolFile,
  serializeToolFile,
} from "../src/host/spec/toolfile.js";
import type {
  PermissionLevel,
  ResolvedImport,
} from "../src/host/spec/types.js";

const tool = (name: string, write = false): ToolDef =>
  define({
    name,
    description: `${name} description`,
    schema: Schema.Struct({ q: Schema.String }),
    meta: { componentId: name, bundle: "web", core: false, write },
    run: async () => "ok",
  });

function resolvedImport(params: {
  uses: string;
  permissions?: Record<string, PermissionLevel>;
  with?: Record<string, unknown>;
  tools?: ToolDef[];
  writeTools?: ToolDef[];
}): ResolvedImport {
  const imp = {
    uses: params.uses,
    ...(params.with && { with: params.with }),
  };
  const { decisions } = applyPermissions({
    imports: [imp],
    ...(params.permissions && { permissions: params.permissions }),
  });
  const parsed = parseUses(params.uses);
  return {
    uses: params.uses,
    parsed,
    domain: decisions[0]!.domain,
    decision: decisions[0]!,
    tools: params.tools ?? [],
    writeTools: params.writeTools ?? [],
  };
}

describe("buildToolFile (AGENT-SPEC §1.3 generated tool file)", () => {
  const imports = [
    resolvedImport({
      uses: "webpage@red-roster",
      tools: [tool("webpage_fetch")],
    }),
    resolvedImport({
      uses: "youtube@red-roster",
      permissions: { youtube: "write" },
      with: { approval: "auto" },
      tools: [tool("youtube_channel_uploads")],
      writeTools: [tool("youtube_playlist_insert", true)],
    }),
    resolvedImport({
      uses: "github@red-roster",
      permissions: { github: "none" },
      tools: [tool("github_issues")],
      writeTools: [tool("github_draft_pr", true)],
    }),
    resolvedImport({
      uses: "home-assistant@red-roster",
      permissions: { "home-assistant": "write" },
      tools: [tool("ha_state")],
      writeTools: [tool("ha_call_service", true)],
    }),
  ];

  test("shape: agent, generated_from, filtered + access-tagged tools", () => {
    const file = buildToolFile({ agent: "oslo", imports });
    expect(file.agent).toBe("oslo");
    expect(file.generated_from).toBe("agents/oslo.yaml");
    expect(file.tools.map((t) => [t.name, t.skill, t.access])).toEqual([
      ["ha_call_service", "home-assistant", "write"],
      ["ha_state", "home-assistant", "read"],
      ["webpage_fetch", "webpage", "read"],
      ["youtube_channel_uploads", "youtube", "read"],
      ["youtube_playlist_insert", "youtube", "write-auto"],
    ]);
    // permissions github: none → nothing from that skill.
    expect(file.tools.some((t) => t.skill === "github")).toBe(false);
    // Entries carry the model-facing JSON schema.
    expect(file.tools[0]!.parameters).toHaveProperty("properties");
    expect(file.tools[0]!.description).toContain("description");
  });

  test("deterministic: import order does not change the serialized artifact", () => {
    const a = serializeToolFile(buildToolFile({ agent: "oslo", imports }));
    const b = serializeToolFile(
      buildToolFile({ agent: "oslo", imports: [...imports].reverse() }),
    );
    expect(a).toBe(b);
    // Stable across repeated builds too.
    expect(serializeToolFile(buildToolFile({ agent: "oslo", imports }))).toBe(a);
  });

  test("duplicate tool names collapse to the first occurrence", () => {
    const dupe = [
      resolvedImport({ uses: "webpage", tools: [tool("webpage_fetch")] }),
      resolvedImport({ uses: "webpage@other", tools: [tool("webpage_fetch")] }),
    ];
    const file = buildToolFile({ agent: "x", imports: dupe });
    expect(file.tools).toHaveLength(1);
  });

  test("serialization is valid JSON ending in a newline", () => {
    const text = serializeToolFile(buildToolFile({ agent: "oslo", imports }));
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text) as { agent: string; tools: unknown[]; };
    expect(parsed.agent).toBe("oslo");
    expect(parsed.tools).toHaveLength(5);
  });
});
