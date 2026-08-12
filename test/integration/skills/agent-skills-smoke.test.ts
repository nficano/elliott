import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAgentSkillPackages } from "../../../src/catalog/bundled";
import { loadSkillRegistrations } from "../../../src/runtime/skills/loader";
import { makeSmokeContext, repoRoot } from "./fixtures";

// Agent-layer custom skills (docs/explanation/agent-skills.md): agents/<name>/skills/
// under ANY root loads through the same package seam as the framework's
// skills/. The elliott repo itself ships no agent skills — the canonical
// agent root is the elliott-agents repo — so the positive path is driven
// against a fixture agent root here.

const FIXTURE_MANIFEST = `apiVersion: elliott/v1
kind: tool
profile: tool-standard
metadata: { namespace: agent-test, name: fixture-skill, version: 1.0.0 }
spec:
  document: TOOL.md
  protocols: [tool.executor]
  egress: { class: none }
  isolation: container
  exports:
    - { ref: tool/fixture-skill, implementation: src/index.ts }
`;

const FIXTURE_MODULE = `export const register = () => ({
  tools: [{
    name: "fixture_ping",
    description: "answers pong",
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async () => "pong",
  }],
});
`;

const makeAgentRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "elliott-agent-root-"));
  const skill = path.join(root, "agents", "tester", "skills", "fixture-skill");
  await mkdir(path.join(skill, "src"), { recursive: true });
  await writeFile(path.join(skill, "manifest.yaml"), FIXTURE_MANIFEST);
  await writeFile(path.join(skill, "TOOL.md"), "# Fixture\n");
  await writeFile(path.join(skill, "src", "index.ts"), FIXTURE_MODULE);
  return root;
};

describe("agent skill packages (phase 1)", () => {
  it("loads an agent's skills from its own root through the real seam", async () => {
    const { context, reported } = await makeSmokeContext();
    const packages = await loadAgentSkillPackages(
      await makeAgentRoot(),
      "tester",
    );
    expect(packages.map((item) => item.name)).toEqual(["fixture-skill"]);

    const skills = await loadSkillRegistrations(packages, context);
    expect(reported).toEqual([]);
    const tool = skills[0]?.registration.tools?.[0];
    expect(tool?.name).toBe("fixture_ping");
    expect(await tool?.execute({})).toBe("pong");
  });

  it("treats a root without that agent's skills directory as empty", async () => {
    expect(await loadAgentSkillPackages(repoRoot, "elliott")).toEqual([]);
    expect(await loadAgentSkillPackages(repoRoot, "no-such-agent"))
      .toEqual([]);
  });
});
