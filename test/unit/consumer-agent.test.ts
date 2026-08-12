import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentComposer, scaffoldConsumerAgent } from "../../src/agent/index";
import { componentRef } from "../../src/core/brands";
import type { ComponentKind } from "../../src/core/types";
import { makeManifest } from "../helpers";

const kindForRef = (ref: string): ComponentKind => {
  if (ref.includes("interaction-profile")) return "interaction-profile";
  if (ref.includes("memory")) return "memory";
  return "tool";
};

describe("M8 consumer agent", () => {
  it("scaffolds the standard standalone consumer layout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "elliott-consumer-"));
    const scaffold = await scaffoldConsumerAgent({
      name: "ada",
      parentDirectory: root,
    });
    const lock = await readFile(
      path.join(scaffold.directory, ".elliott/lock.yaml"),
      "utf8",
    );
    expect(lock).toContain("resolutions");
    const relative = scaffold.files.map((file) =>
      path.relative(scaffold.directory, file)
    );
    expect(relative).toContain("agent.yaml");
    expect(relative).toContain("AGENTS.md");
    expect(relative).toContain("main.ts");
    expect(relative).toContain(path.join("config", "elliott.yaml"));
    expect(relative).toContain(path.join("config", "secrets.yaml"));
    expect(relative).toContain(path.join("agents", "ada", "agent.yaml"));
    expect(relative).toContain(path.join("assets", "prompts", "ada.md"));
    // Required LLM config is env-backed with no baked-in endpoint or model.
    const runtimeConfig = await readFile(
      path.join(scaffold.directory, "config/elliott.yaml"),
      "utf8",
    );
    expect(runtimeConfig).toContain("${ENV:ELLIOTT_LLM_BASE_URL}");
    expect(runtimeConfig).toContain("${ENV:ELLIOTT_LLM_MODEL}");
    const agentDefinition = await readFile(
      path.join(scaffold.directory, "agents/ada/agent.yaml"),
      "utf8",
    );
    expect(agentDefinition).toContain("modelProfile: default");
    expect(agentDefinition).toContain("persona: assets/prompts/ada.md");
    const main = await readFile(
      path.join(scaffold.directory, "main.ts"),
      "utf8",
    );
    expect(main).toContain("agentName: \"ada\"");
    const modules = path.join(scaffold.directory, "node_modules");
    await mkdir(modules);
    await symlink(
      path.resolve(import.meta.dir, "../.."),
      path.join(modules, "elliott"),
      "dir",
    );
    const test = Bun.spawn(
      ["bun", "test", "./.elliott/tests/agent.test.ts"],
      { cwd: scaffold.directory, stdout: "pipe", stderr: "pipe" },
    );
    expect(await test.exited).toBe(0);
  });

  it("composes refs on the default loop and intersects child ceilings", () => {
    const refs = [
      componentRef("builtin/interaction-profile/default"),
      componentRef("builtin/memory/curated"),
      componentRef("builtin/memory/session-store"),
      componentRef("workspace/tool/example"),
    ];
    const manifests = new Map(refs.map((ref) => [
      ref,
      makeManifest(
        kindForRef(ref),
        ref,
        ref.includes("tool")
          ? [{
            capability: "network.connect",
            resources: ["allowed.example", "denied.example"],
          }]
          : [],
      ),
    ]));
    const composed = new AgentComposer({
      resolveManifest(ref) {
        return manifests.get(ref);
      },
    }).compose({
      ref: componentRef("workspace/agent/ada"),
      interactionProfile: refs[0] ?? componentRef("missing"),
      models: { defaultProfile: "balanced", maximumProfile: "deep" },
      skills: [refs[3] ?? componentRef("missing")],
      memory: {
        curated: refs[1] ?? componentRef("missing"),
        sessions: refs[2] ?? componentRef("missing"),
      },
      gateways: [],
      mcp: [],
      policies: [],
      evaluators: [],
      capabilityCeiling: ["network.connect:allowed.example"],
      learning: { mode: "proposals", autoApply: false },
    });
    expect(composed.loop).toBe("default");
    expect(
      composed.children.find((child) => child.manifest.schema.kind === "tool")
        ?.effectiveCapabilities[0]?.resources,
    ).toEqual(["allowed.example"]);
  });
});
