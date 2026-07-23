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
    expect(
      scaffold.files.map((file) => path.relative(scaffold.directory, file)),
    ).toContain("agent.yaml");
    expect(
      scaffold.files.map((file) => path.relative(scaffold.directory, file)),
    ).toContain("AGENTS.md");
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
