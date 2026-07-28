import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  componentRef,
  digest,
  principalId,
  protocolId,
  scopeId,
  snapshotId,
} from "../../src/core/brands";
import { ComponentDiscovery } from "../../src/core/registry/discovery";
import { ComponentRegistry } from "../../src/core/registry/registry";
import { loadAgentSkill } from "../../src/manifest/agentskills";
import { scaffoldComponent } from "../../src/manifest/scaffold";
import { expandCapabilityTemplate } from "../../src/manifest/templates";
import {
  assertContainedPath,
  parseSecurityOverlay,
} from "../../src/manifest/yaml";
import { makeManifest, testProtocol } from "../helpers";

describe("M2 manifests and discovery", () => {
  it("loads bare Agent Skills with prompt visibility and zero authority", () => {
    const skill = loadAgentSkill({
      namespace: "workspace",
      markdown:
        "---\nname: review\ndescription: Review code\nallowed-tools: Bash\n---\nSteps",
      trustedWorkspace: true,
    });
    expect(skill.markdown).toBe("Steps");
    expect(skill.allowedTools).toEqual(["Bash"]);
    expect(skill.requestedCapabilities).toEqual([]);
  });

  it("expands versioned templates and lets removals win", () => {
    const expanded = expandCapabilityTemplate(
      "tool-standard",
      [{ capability: "process.execute", resources: ["executable://git"] }],
      ["network.fetch"],
    );
    expect(
      expanded.requestedCapabilities.some((request) =>
        request.capability === "process.execute"
      ),
    ).toBe(true);
    expect(
      expanded.requestedCapabilities.some((request) =>
        request.capability === "network.fetch"
      ),
    ).toBe(false);
    expect(expanded.manifestDigest).not.toBe(
      digest("template-with-different-version"),
    );
  });

  it("rejects duplicate keys, custom tags, and escaping symlinks", async () => {
    expect(() => parseSecurityOverlay("kind: tool\nkind: skill\n")).toThrow();
    expect(() => parseSecurityOverlay("kind: !unsafe tool\n")).toThrow();
    const temporary = await mkdtemp(path.join(tmpdir(), "elliott-manifest-"));
    const root = path.join(temporary, "root");
    const outside = path.join(temporary, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, path.join(root, "escape"));
    await expect(assertContainedPath(root, "escape")).rejects.toThrow();
    await rm(temporary, { recursive: true, force: true });
  });

  it("keeps startup cards compact and loads exact schemas only on inspect", () => {
    const registry = new ComponentRegistry();
    const manifest = makeManifest(
      "tool",
      "workspace/tool/searchable",
      [],
      [testProtocol()],
    );
    registry.register(manifest, {
      scope: { level: "workspace", id: scopeId("workspace") },
    });
    const discovery = new ComponentDiscovery(registry);
    const card = discovery.search("searchable")[0];
    expect(card).not.toHaveProperty("protocols");
    expect(discovery.inspect(manifest.ref).protocols[0]?.schema).toEqual({
      type: "object",
    });
    const prepared = discovery.prepareCall({
      principal: principalId("principal"),
      agent: componentRef("workspace/agent/test"),
      target: manifest.ref,
      protocol: protocolId("tool.executor"),
      operation: "execute",
      input: { value: true },
      inputSchemaDigest: digest("input"),
      outputSchemaDigest: digest("output"),
      origin: {
        id: "origin",
        actorTrust: "authenticated",
        contentTrust: "untrusted",
        classification: "internal",
        securityTags: [],
        payload: {},
        createdAt: new Date().toISOString(),
      },
      securityTags: [],
      requestedCapabilities: [],
      budget: {},
      snapshot: snapshotId("snapshot"),
    });
    expect(prepared.invocation.target).toBe(manifest.ref);
  });

  it("scaffolds a runnable skill with a G1/G3 conformance stub", async () => {
    const temporary = await mkdtemp(
      path.join(process.cwd(), ".elliott-scaffold-"),
    );
    const result = await scaffoldComponent({
      kind: "skill",
      name: "example-skill",
      parentDirectory: temporary,
    });
    expect(result.files).toHaveLength(3);
    expect(
      await readFile(path.join(result.directory, "manifest.yaml"), "utf8"),
    )
      .toContain("profile: tool-standard");
    const conformance = await readFile(result.files[2] ?? "", "utf8");
    expect(conformance).toContain("defineComponent");
    expect(conformance).toContain("runtimeContractDigest");
    expect(conformance).not.toContain(
      "expect(\"skill\").toBe(\"skill\")",
    );
    const generatedTest = Bun.spawn([
      "bun",
      "test",
      result.files[2] ?? "",
    ], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await generatedTest.exited).toBe(0);
    await expect(scaffoldComponent({
      kind: "tool",
      name: "../escape",
      parentDirectory: temporary,
    })).rejects.toThrow("kebab-case");
    await rm(temporary, { recursive: true, force: true });
  });
});
