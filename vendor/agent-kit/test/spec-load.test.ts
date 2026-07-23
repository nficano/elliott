import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { define } from "../src/core/agent/index.js";
import { loadConfig } from "../src/host/config/load.js";
import type { Registrable } from "../src/host/registry/types.js";
import { isDeferredExpr } from "../src/host/spec/interpolate.js";
import { makeSpecJobRunner } from "../src/host/spec/jobs.js";
import { parseLockfile, RefResolutionError } from "../src/host/spec/lock.js";
import { compileAgentSpecs, loadAgentSpecs } from "../src/host/spec/load.js";
import { SpecLoadError } from "../src/host/spec/compile.js";
import type {
  CompiledUsesStep,
  SpecKitOptions,
  ToolFile,
} from "../src/host/spec/types.js";
import type { TurnResult } from "../src/host/runtime/types.js";

const FIXTURE = nodePath.join(import.meta.dir, "fixtures", "spec");

function localEchoSkill(): Registrable {
  return {
    manifest: {
      id: "local-echo",
      kind: "skill",
      version: "0.1.0",
      configSchema: Schema.Record(Schema.String, Schema.Unknown),
      trust: "write",
      secrets: [{ name: "token", required: false }],
    },
    async activate() {
      return {
        tools: [
          define({
            name: "local_echo",
            description: "Echo the arguments back as JSON.",
            schema: Schema.Record(Schema.String, Schema.Unknown),
            meta: {
              componentId: "local-echo",
              bundle: "web",
              core: false,
              write: false,
            },
            run: async (args) => JSON.stringify({ echoed: args }),
          }),
        ],
      };
    },
  };
}

/** Copy the fixture so loadAgentSpecs' artifacts land in a throwaway dir. */
async function fixtureCopy(): Promise<string> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "agent-spec-"));
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

function optsFor(dir: string): SpecKitOptions {
  return {
    configDir: nodePath.join(dir, "config"),
    specsDir: nodePath.join(dir, "agents"),
    env: "test",
    localSkills: { "./skills/local-echo": localEchoSkill() },
  };
}

/** Point the fixture's webpage import at a git ref. */
async function useRef(dir: string, ref: string): Promise<void> {
  const specPath = nodePath.join(dir, "agents", "test.yaml");
  const text = await readFile(specPath, "utf8");
  await writeFile(specPath, text.replace("- uses: webpage", `- uses: ${ref}`));
}

/** A throwaway git repo holding src/skills/webpage at a debaser-named tag. */
async function makeTaggedRepo(tag: string): Promise<string> {
  const repo = await mkdtemp(nodePath.join(tmpdir(), "spec-repo-"));
  // webpage is a web-pack member — the lock pins the pack tree (src/skills/web)
  await mkdir(nodePath.join(repo, "src", "skills", "web"), {
    recursive: true,
  });
  await writeFile(
    nodePath.join(repo, "src", "skills", "web", "webpage.ts"),
    "// fixture skill tree\n",
  );
  const git = (...args: string[]) => {
    const base = [
      "git",
      "-c",
      "user.email=spec@test",
      "-c",
      "user.name=spec",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
    ];
    const result = Bun.spawnSync([...base, ...args], { cwd: repo });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("tag", tag);
  return repo;
}

describe("loadAgentSpecs end-to-end (fixture)", () => {
  test("compiles the full AgentKitOptions shape without booting", async () => {
    const dir = await fixtureCopy();
    const kit = await loadAgentSpecs(optsFor(dir));

    // Runtime AgentSpec[]: persona from assets, tier from model.default,
    // trust write because a permission is write, maxRounds default.
    expect(kit.options.agents).toEqual([
      {
        id: "test-agent",
        persona: "You are test-agent, the fixture persona.\n",
        tier: "fast",
        maxRounds: 8,
        trust: "write",
      },
    ]);

    // Durable schedules with the per-job tier override.
    expect(kit.options.schedules).toEqual([
      {
        id: "test-agent:daily-brief",
        cron: "0 7 * * *",
        agentId: "test-agent",
        tier: "standard",
      },
    ]);

    // Config fragments: spec enablement wins, secrets bound from secrets.yaml,
    // import `with:` fields inline, consumer YAML fields preserved underneath.
    expect(kit.options.configOverlay).toEqual({
      skills: {
        webpage: { enabled: true },
        "local-echo": {
          enabled: true,
          approval: "auto",
          secrets: { token: "plain-token-value" },
        },
      },
    });
    expect(kit.overlay).toBe(kit.options.configOverlay!);

    // Registrables: the webpage builtin + the local skill ride along.
    const ids = (kit.options.registrables ?? []).map((r) => r.manifest.id);
    expect(ids.sort()).toEqual(["local-echo", "webpage"]);

    // Base options passthrough.
    expect(kit.options.configDir).toBe(nodePath.join(dir, "config"));
    expect(kit.options.env).toBe("test");

    // Jobs: scheduled + manual, deferred steps intact.
    expect(kit.jobs.map((j) => j.id)).toEqual([
      "test-agent:daily-brief",
      "test-agent:manual-poke",
    ]);
    const daily = kit.jobs[0]!;
    expect(daily.steps.map((s) => s.id)).toEqual(["fetch", "turn", "send"]);
    const fetch = daily.steps[0] as CompiledUsesStep;
    // Load-time config resolved eagerly; whole-value kept the array type…
    expect((fetch.args as { items: unknown; }).items).toEqual(["alpha", "beta"]);
    // …embedded expression stringified…
    expect((fetch.args as { note: unknown; }).note).toBe(
      "prefix hello suffix",
    );
    // …and the steps.* reference survived as a deferred expression.
    const send = daily.steps[2] as CompiledUsesStep;
    expect(isDeferredExpr((send.args as { body: unknown; }).body)).toBe(true);
    expect(kit.jobs[1]!.manual).toBe(true);

    // Refless dev mode: no refs, no lockfile written.
    expect(kit.refs).toEqual([]);
    expect(existsSync(nodePath.join(dir, "agent-kit.lock"))).toBe(false);
    expect(kit.warnings).toEqual([]);
  });

  test("writes the inspectable tool file artifact", async () => {
    const dir = await fixtureCopy();
    await loadAgentSpecs(optsFor(dir));
    const artifact = nodePath.join(dir, "agents", "test-agent.tools.json");
    expect(existsSync(artifact)).toBe(true);
    const toolFile = JSON.parse(await readFile(artifact, "utf8")) as ToolFile;
    expect(toolFile.agent).toBe("test-agent");
    expect(toolFile.generated_from).toBe("agents/test-agent.yaml");
    expect(toolFile.tools.map((t) => [t.name, t.skill, t.access])).toEqual([
      ["local_echo", "local-echo", "read"],
      ["webpage_fetch", "webpage", "read"],
    ]);
    expect(toolFile.tools[1]!.parameters).toHaveProperty("properties");
  });

  test("the compiled daily-brief job runs end-to-end against fakes", async () => {
    const dir = await fixtureCopy();
    const kit = await compileAgentSpecs(optsFor(dir));
    const echo = localEchoSkill();
    const active = await echo.activate({
      config: {},
      get: (() => {
        throw new Error("no services");
      }) as never,
      tier: "fast",
      profile: {},
      secrets: {},
    });
    const turns: string[] = [];
    const outputs = await makeSpecJobRunner({
      job: kit.jobs[0]!,
      deps: {
        registry: {
          activate: async (id) => {
            if (id !== "local-echo") throw new Error(`unexpected ${id}`);
            return active;
          },
        },
        runtime: {
          runTurn: async (input): Promise<TurnResult> => {
            turns.push(input.text);
            return {
              text: "BRIEF",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
              rounds: 1,
              roundsExhausted: false,
              toolCalls: 0,
              costUsd: 0,
              traceId: "t",
            };
          },
        },
        assetsDir: kit.assetsDir,
      },
    })();
    expect(outputs.fetch).toEqual({
      echoed: { items: ["alpha", "beta"], note: "prefix hello suffix" },
    });
    expect(outputs.turn).toEqual({ text: "BRIEF" });
    expect(outputs.send).toEqual({ echoed: { body: "BRIEF" } });
    expect(turns[0]).toContain("Summarize the fetched items");
    expect(turns[0]).toContain('"echoed"');
  });

  test("an unknown skill is a load error listing what IS available", async () => {
    const dir = await fixtureCopy();
    const opts = { ...optsFor(dir), localSkills: {} };
    let caught: unknown;
    try {
      await compileAgentSpecs(opts);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpecLoadError);
    const message = (caught as Error).message;
    expect(message).toContain("./skills/local-echo");
    expect(message).toContain("webpage"); // the builtin list is spelled out
  });

  test("lockfile flow: refs resolve against git tags and pin the lock", async () => {
    const repo = await makeTaggedRepo("red-roster");
    const dir = await fixtureCopy();
    await useRef(dir, "webpage@red-roster");
    const opts = { ...optsFor(dir), repoRoot: repo };
    const kit = await loadAgentSpecs(opts);
    expect(kit.refs).toEqual([{ skill: "webpage", ref: "red-roster" }]);
    const lockPath = nodePath.join(dir, "agent-kit.lock");
    expect(existsSync(lockPath)).toBe(true);
    const lock = parseLockfile(await readFile(lockPath, "utf8"));
    expect(lock.entries).toHaveLength(1);
    expect(lock.entries[0]!.skill).toBe("webpage");
    expect(lock.entries[0]!.ref).toBe("red-roster");
    expect(lock.entries[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    // Second load: lock verifies against HEAD (no drift) and stays put.
    const again = await loadAgentSpecs(opts);
    expect(again.warnings).toEqual([]);
    expect(parseLockfile(await readFile(lockPath, "utf8"))).toEqual(lock);
  });

  test("a ref naming a missing tag fails with the lock error", async () => {
    const repo = await makeTaggedRepo("red-roster");
    const dir = await fixtureCopy();
    await useRef(dir, "webpage@ghost-tag");
    await expect(
      loadAgentSpecs({ ...optsFor(dir), repoRoot: repo }),
    ).rejects.toThrow(RefResolutionError);
  });

  test("a missing persona file is a clear load error", async () => {
    const dir = await fixtureCopy();
    const opts = { ...optsFor(dir), assetsDir: nodePath.join(dir, "prompts") };
    await expect(compileAgentSpecs(opts)).rejects.toThrow(
      /persona file not found/,
    );
  });

  test("the config loader applies the overlay (spec enablement wins)", async () => {
    const dir = await fixtureCopy();
    const kit = await loadAgentSpecs(optsFor(dir));
    const { config } = await loadConfig({
      dir: nodePath.join(dir, "config"),
      env: "test",
      overlay: kit.options.configOverlay!,
    });
    const webpage = config.skills.webpage as Record<string, unknown>;
    expect(webpage.enabled).toBe(true); // spec enablement won
    expect(webpage.timeout_note).toBe("from-consumer-config"); // consumer kept
    const echo = config.skills["local-echo"] as Record<string, unknown>;
    expect(echo.enabled).toBe(true);
    expect(echo.secrets).toEqual({ token: "plain-token-value" });
    // Without the overlay nothing is enabled (opt-in default, §5).
    const bare = await loadConfig({
      dir: nodePath.join(dir, "config"),
      env: "test",
    });
    expect((bare.config.skills.webpage as Record<string, unknown>).enabled)
      .toBe(false);
  });

  test("a merged config that fails schema decode is a load error", async () => {
    const dir = await fixtureCopy();
    const badDir = nodePath.join(dir, "bad-config");
    await mkdir(badDir, { recursive: true });
    // Core section invalid (store.dsn missing) → merged decode must fail fast.
    await writeFile(nodePath.join(badDir, "defaults.yaml"), "store: {}\n", "utf8");
    await cp(
      nodePath.join(dir, "config", "secrets.yaml"),
      nodePath.join(badDir, "secrets.yaml"),
    );
    const bad = { ...optsFor(dir), configDir: badDir };
    await expect(compileAgentSpecs(bad)).rejects.toThrow(/failed to validate/);
  });
});
