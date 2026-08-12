import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentKernel } from "../../../src/kernel";
import { EvolutionConfig } from "../../../src/learning/evolution/config";
import { makeRuntimeEvolutionIntegration } from "../../../src/runtime/evolution";
import type { RuntimeSettings } from "../../../src/runtime/types";

const repoRoot = path.resolve(import.meta.dir, "../../..");

const evolutionConfig = EvolutionConfig.make({
  apiVersion: "elliott/v1",
  engines: {
    text: { primary: "organization/evaluator/dspy-gepa" },
    code: { primary: "organization/evaluator/darwinian" },
  },
  budgets: {
    perRun: {
      candidates: 2,
      tokens: 100,
      costUsd: 1,
      durationMinutes: 1,
    },
    monthly: { costUsd: 10 },
  },
  evaluation: {
    authoringProfile: "author",
    judgingProfile: "judge",
    requireDistinctRoute: true,
    split: { train: 0.6, validation: 0.2, holdout: 0.2 },
  },
  continuous: {
    enabled: false,
    benchmarkCron: "0 3 * * 0",
    maximumRiskClass: "C2",
    maximumConcurrentRuns: 1,
  },
  targets: {
    allow: ["workspace/skill/*", "core/tool/*", "core/prompt/*"],
    deny: [],
  },
});

const baseSettings = async (): Promise<RuntimeSettings> => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "evo-wire-"));
  await mkdir(path.join(stateDirectory, "evolution"), { recursive: true });
  return {
    environment: "test",
    release: "test",
    timezone: "UTC",
    port: 0,
    persona: path.join(repoRoot, "prompts"),
    model: "echo",
    maxTokens: 128,
    temperature: 0,
    llmBaseUrl: "http://127.0.0.1:1/v1",
    llmApiKey: "x",
    stateDirectory,
    browser: { baseUrl: "", token: "", allowedDomains: [] },
    mcp: [],
    evolution: evolutionConfig,
    evolutionRuntime: {
      controlToken: "control-token",
      operatorPrincipalId: "operator",
      operatorCapabilities: [
        "evolution.target.read",
        "evolution.run.read",
        "evolution.engine.invoke",
      ],
      agentCapabilities: [
        "evolution.target.read",
        "evolution.engine.invoke",
        "evolution.run.read",
        "proposal.author",
      ],
      schedulerCapabilities: [],
    },
    governance: { deny: [] },
  };
};

describe("makeRuntimeEvolutionIntegration", () => {
  it("returns undefined when evolution or runtime settings are absent", async () => {
    const settings = await baseSettings();
    const kernel = new AgentKernel();
    expect(
      await makeRuntimeEvolutionIntegration(
        repoRoot,
        { ...settings, evolution: undefined },
        kernel,
        () => "snap",
        () => undefined,
        [],
      ),
    ).toBeUndefined();
    expect(
      await makeRuntimeEvolutionIntegration(
        repoRoot,
        { ...settings, evolutionRuntime: undefined },
        kernel,
        () => "snap",
        () => undefined,
        [],
      ),
    ).toBeUndefined();
  });

  it("wires stores, unavailable engines, control plane, and agent tools", async () => {
    const settings = await baseSettings();
    const kernel = new AgentKernel();
    const integration = await makeRuntimeEvolutionIntegration(
      repoRoot,
      settings,
      kernel,
      () => "snapshot:active",
      () => undefined,
      [{
        name: "file_read",
        description: "read",
        inputSchema: { type: "object", properties: {} },
        execute: async () => "{}",
      }],
    );
    expect(integration).toBeDefined();
    if (integration === undefined) return;

    const decorated = integration.decorateTools([{
      name: "file_read",
      description: "read",
      inputSchema: { type: "object", properties: {} },
      execute: async () => "{}",
    }]);
    expect(decorated[0]?.name).toBe("file_read");

    const persona = await Bun.file(
      path.join(repoRoot, "assets/prompts/elliott.md"),
    ).text().catch(() => "# persona\n");
    const decorate = integration.decoratePersona(
      "assets/prompts/elliott.md",
      persona,
    );
    expect(typeof decorate()).toBe("string");

    const toolTargets = await integration.targetsForTool("file_read");
    expect(Array.isArray(toolTargets)).toBe(true);
    const turnTargets = await integration.turnTargets();
    expect(Array.isArray(turnTargets)).toBe(true);

    expect(integration.agentTools.length).toBeGreaterThan(0);
    const agentInputs: Readonly<
      Record<string, Readonly<Record<string, string>>>
    > = {
      evolution_inspect_target: { target_ref: "missing" },
      evolution_request_run: { target_ref: "missing" },
      evolution_get_status: { run_id: "evr_missing" },
      evolution_request_proposal: {
        run_id: "evr_missing",
        candidate_id: "evc_missing",
      },
    };
    for (const tool of integration.agentTools) {
      const input = agentInputs[tool.name];
      if (input === undefined) continue;
      await expect(tool.execute(input)).rejects.toThrow();
    }

    const accepted = await integration.controlPlane.handle(
      new Request("https://elliott.test/v1/control/evolution", {
        method: "POST",
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "evolution.inspect",
          arguments: ["workspace/skill/missing"],
        }),
      }),
    );
    // inspect may 500 on missing target; authority must still accept the bearer.
    expect([200, 400, 500]).toContain(accepted.status);

    const rejected = await integration.controlPlane.handle(
      new Request("https://elliott.test/v1/control/evolution", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "evolution.status",
          arguments: ["evr_x"],
        }),
      }),
    );
    expect(rejected.status).toBe(401);
  });
});
