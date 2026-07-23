import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { parse as parseYaml } from "yaml";
import { define } from "../src/core/agent/index.js";
import type { ToolDef } from "../src/core/agent/types.js";
import type { Active } from "../src/host/registry/types.js";
import type { TurnInput, TurnResult } from "../src/host/runtime/types.js";
import { interpolateSpecTree } from "../src/host/spec/interpolate.js";
import {
  compileJobs,
  makeSpecJobRunner,
  registerSpecJobHandlers,
  SpecJobError,
} from "../src/host/spec/jobs.js";
import type { ParsedUses } from "../src/host/spec/refs.js";
import { parseAgentSpec } from "../src/host/spec/schema.js";
import type {
  AgentSpecFile,
  CompiledJob,
  SpecJobDeps,
} from "../src/host/spec/types.js";

const FILE = "agents/oslo.yaml";

function specFrom(yamlText: string): AgentSpecFile {
  const validated = parseAgentSpec({ file: FILE, raw: parseYaml(yamlText) });
  return interpolateSpecTree(validated, {
    file: FILE,
    secrets: {},
    config: (validated.config ?? {}),
  }) as AgentSpecFile;
}

const resolveSkillIds = (parsed: ParsedUses): string[] =>
  parsed.kind === "local" ? [parsed.id] : [parsed.skill];

const echoTool = (params: {
  name: string;
  write?: boolean;
  result?: (args: Record<string, unknown>) => unknown;
  fail?: string;
}): ToolDef =>
  define({
    name: params.name,
    description: `${params.name} test tool`,
    schema: Schema.Record(Schema.String, Schema.Unknown),
    meta: {
      componentId: params.name,
      bundle: "web",
      core: false,
      write: params.write ?? false,
    },
    run: async (args) => {
      if (params.fail) throw new Error(params.fail);
      return JSON.stringify(params.result?.(args) ?? { echoed: args });
    },
  });

function fakeRegistry(actives: Record<string, Active>) {
  const activated: string[] = [];
  return {
    activated,
    activate: async (id: string): Promise<Active> => {
      const active = actives[id];
      if (!active) throw new Error(`no registrable '${id}'`);
      activated.push(id);
      return active;
    },
  };
}

const noRuntime = {
  runTurn: async (): Promise<TurnResult> => {
    throw new Error("runTurn must not be called");
  },
};

const THREE_STEP = `
name: oslo
config:
  channels: [c1, c2]
permissions:
  collect: write
jobs:
  merge:
    on: { schedule: "0 * * * *" }
    steps:
      - id: uploads
        uses: alpha/channel-uploads@red-roster
        with:
          channels: "\${{ config.channels }}"
      - id: pakman
        uses: ./skills/pakman
      - uses: collect/playlist-insert@red-roster
        with:
          items: "\${{ steps.uploads.outputs.videos + steps.pakman.outputs.videos }}"
`;

describe("compileJobs", () => {
  test("compiles ScheduleSpec + steps with default ids", () => {
    const jobs = compileJobs({
      agent: "oslo",
      spec: specFrom(THREE_STEP),
      resolveSkillIds,
    });
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.id).toBe("oslo:merge");
    expect(job.manual).toBe(false);
    expect(job.schedule).toEqual({
      id: "oslo:merge",
      cron: "0 * * * *",
      agentId: "oslo",
    });
    // Default step id: explicit id > op name > "turn".
    expect(job.steps.map((s) => s.id)).toEqual([
      "uploads",
      "pakman",
      "playlist-insert",
    ]);
    const insert = job.steps[2];
    expect(insert.type).toBe("uses");
    if (insert.type === "uses") {
      expect(insert.toolNames).toEqual([
        "collect_playlist_insert",
        "playlist_insert",
      ]);
      expect(insert.allowWrite).toBe(true);
      expect(insert.registrableIds).toEqual(["collect"]);
    }
  });

  test("per-job model override reaches the ScheduleSpec tier and turn steps", () => {
    const jobs = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
model:
  default: fast
  briefing: standard
jobs:
  briefing:
    on: { schedule: "0 7 * * *" }
    steps:
      - turn:
          prompt: prompts/briefing.md
`),
      resolveSkillIds,
    });
    expect(jobs[0].schedule?.tier).toBe("standard");
    const turn = jobs[0].steps[0];
    expect(turn.type).toBe("turn");
    if (turn.type === "turn") expect(turn.tier).toBe("standard");
  });

  test("a turn step's own model beats the job tier", () => {
    const jobs = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
model: { default: fast }
jobs:
  j:
    on: { manual: true }
    steps:
      - turn:
          prompt: p.md
          model: { tier: deep, profile: writing }
`),
      resolveSkillIds,
    });
    const turn = jobs[0].steps[0];
    if (turn.type === "turn") expect(turn.tier).toBe("deep");
  });

  test("duplicate step ids fail naming agent and job", () => {
    expect(() =>
      compileJobs({
        agent: "oslo",
        spec: specFrom(`
name: oslo
jobs:
  dup:
    on: { manual: true }
    steps:
      - id: same
        uses: alpha
      - id: same
        uses: alpha
`),
        resolveSkillIds,
      })
    ).toThrow(/agent "oslo" job "dup".*duplicate step id "same"/);
  });

  test("a step using a permissions:none skill fails at compile", () => {
    expect(() =>
      compileJobs({
        agent: "oslo",
        spec: specFrom(`
name: oslo
permissions: { blocked: none }
jobs:
  j:
    on: { manual: true }
    steps:
      - uses: blocked/thing
`),
        resolveSkillIds,
      })
    ).toThrow(SpecJobError);
  });
});

describe("spec job runner", () => {
  const actives: Record<string, Active> = {
    alpha: {
      tools: [
        echoTool({
          name: "alpha_channel_uploads",
          result: (args) => ({ videos: ["u1", "u2"], channels: args.channels }),
        }),
      ],
    },
    pakman: {
      tools: [
        echoTool({ name: "pakman", result: () => ({ videos: ["p1"] }) }),
      ],
    },
    collect: {
      tools: [],
      writeTools: [
        echoTool({
          name: "collect_playlist_insert",
          write: true,
          result: (args) => ({ inserted: args.items }),
        }),
      ],
    },
  };

  const compile = (): CompiledJob =>
    compileJobs({
      agent: "oslo",
      spec: specFrom(THREE_STEP),
      resolveSkillIds,
    })[0];

  test("3-step uses→uses→uses run chains outputs through steps.*", async () => {
    const registry = fakeRegistry(actives);
    const deps: SpecJobDeps = {
      registry,
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    const outputs = await makeSpecJobRunner({ job: compile(), deps })();
    expect(outputs.uploads).toEqual({
      videos: ["u1", "u2"],
      channels: ["c1", "c2"], // ${{ config.channels }} resolved at load
    });
    expect(outputs.pakman).toEqual({ videos: ["p1"] });
    // ${{ steps.uploads… + steps.pakman… }} resolved right before the step ran.
    expect(outputs["playlist-insert"]).toEqual({
      inserted: ["u1", "u2", "p1"],
    });
    // Skills were activated lazily through the registry.
    expect(registry.activated).toEqual(["alpha", "pakman", "collect"]);
  });

  test("a write tool is invisible without permissions: write", async () => {
    const spec = specFrom(
      THREE_STEP.replace("permissions:\n  collect: write\n", ""),
    );
    const job = compileJobs({ agent: "oslo", spec, resolveSkillIds })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry(actives),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    await expect(makeSpecJobRunner({ job, deps })()).rejects.toThrow(
      /no tool matching/,
    );
  });

  test("a failing tool fails the job naming agent/job/step", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  boom:
    on: { manual: true }
    steps:
      - id: kaboom
        uses: alpha/channel-uploads
`),
      resolveSkillIds,
    })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({
        alpha: {
          tools: [
            echoTool({ name: "alpha_channel_uploads", fail: "quota hit" }),
          ],
        },
      }),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    let caught: unknown;
    try {
      await makeSpecJobRunner({ job, deps })();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpecJobError);
    const message = (caught as Error).message;
    expect(message).toContain("agent \"oslo\"");
    expect(message).toContain("job \"boom\"");
    expect(message).toContain("step \"kaboom\"");
    expect(message).toContain("quota hit");
  });

  test("a `{\"error\": ...}` success payload fails the step with that message", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  boom:
    on: { manual: true }
    steps:
      - id: kaboom
        uses: alpha/channel-uploads
`),
      resolveSkillIds,
    })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({
        alpha: {
          tools: [
            echoTool({
              name: "alpha_channel_uploads",
              result: () => ({ error: "HTTP 404: playlist cannot be found" }),
            }),
          ],
        },
      }),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    await expect(makeSpecJobRunner({ job, deps })()).rejects.toThrow(
      /step "kaboom" failed: HTTP 404: playlist cannot be found/,
    );
  });

  test("an unmatched tool name errors listing what IS available", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  j:
    on: { manual: true }
    steps:
      - uses: alpha/wrong-op
`),
      resolveSkillIds,
    })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({
        alpha: {
          tools: [
            echoTool({ name: "alpha_one" }),
            echoTool({ name: "alpha_two" }),
          ],
        },
      }),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    await expect(makeSpecJobRunner({ job, deps })()).rejects.toThrow(
      /alpha_one, alpha_two/,
    );
  });

  test("a skill exposing exactly one tool needs no name match", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  j:
    on: { manual: true }
    steps:
      - id: only
        uses: solo
`),
      resolveSkillIds,
    })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({
        solo: {
          tools: [
            echoTool({ name: "unrelated_name", result: () => ({ ok: 1 }) }),
          ],
        },
      }),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    const outputs = await makeSpecJobRunner({ job, deps })();
    expect(outputs.only).toEqual({ ok: 1 });
  });

  test("a non-JSON tool result is stored as raw text", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  j:
    on: { manual: true }
    steps:
      - id: raw
        uses: texty
`),
      resolveSkillIds,
    })[0];
    const rawTool = define({
      name: "texty",
      description: "returns plain text",
      schema: Schema.Record(Schema.String, Schema.Unknown),
      meta: { componentId: "texty", bundle: "web", core: false, write: false },
      run: async () => "just words",
    });
    const deps: SpecJobDeps = {
      registry: fakeRegistry({ texty: { tools: [rawTool] } }),
      runtime: noRuntime,
      assetsDir: "/nowhere",
    };
    const outputs = await makeSpecJobRunner({ job, deps })();
    expect(outputs.raw).toBe("just words");
  });

  test("turn step: prompt file + interpolated context → runTurn", async () => {
    const dir = await mkdtemp(nodePath.join(tmpdir(), "spec-turn-"));
    await writeFile(
      nodePath.join(dir, "briefing.md"),
      "Summarize the digest.",
      "utf8",
    );
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
model: { default: fast }
jobs:
  briefing:
    on: { schedule: "0 7 * * *" }
    steps:
      - id: digest
        uses: alpha/channel-uploads
      - turn:
          prompt: briefing.md
          model: standard
          context:
            digest: "\${{ steps.digest.outputs }}"
      - id: send
        uses: alpha/channel-uploads
        with:
          body: "\${{ steps.turn.outputs.text }}"
`),
      resolveSkillIds,
    })[0];
    const turns: TurnInput[] = [];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({
        alpha: {
          tools: [
            echoTool({
              name: "alpha_channel_uploads",
              result: (args) => ({ videos: [9], ...args }),
            }),
          ],
        },
      }),
      runtime: {
        runTurn: async (input) => {
          turns.push(input);
          return {
            text: "THE BRIEF",
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
      assetsDir: dir,
    };
    const outputs = await makeSpecJobRunner({ job, deps })();
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn.agentId).toBe("oslo");
    expect(turn.conversationKey).toBe("job:oslo:briefing");
    expect(turn.origin).toBe("internal");
    expect(turn.tier).toBe("standard");
    expect(turn.text).toContain("Summarize the digest.");
    expect(turn.text).toContain("## Context");
    expect(turn.text).toContain("\"videos\"");
    expect(outputs.turn).toEqual({ text: "THE BRIEF" });
    // The turn's outputs chained into the next step.
    expect(outputs.send).toEqual({ videos: [9], body: "THE BRIEF" });
  });

  test("a missing turn prompt file is a clear step failure", async () => {
    const job = compileJobs({
      agent: "oslo",
      spec: specFrom(`
name: oslo
jobs:
  j:
    on: { manual: true }
    steps:
      - turn:
          prompt: prompts/ghost.md
`),
      resolveSkillIds,
    })[0];
    const deps: SpecJobDeps = {
      registry: fakeRegistry({}),
      runtime: noRuntime,
      assetsDir: "/definitely/missing",
    };
    await expect(makeSpecJobRunner({ job, deps })()).rejects.toThrow(
      /step "turn".*prompt file not found/,
    );
  });
});

describe("registerSpecJobHandlers (scheduler seam)", () => {
  test("registers sched:<agent>:<job> handlers, overriding the generic one", async () => {
    const handlers = new Map<string, (job: unknown) => Promise<void>>();
    const queue = {
      handle: (kind: string, handler: (job: unknown) => Promise<void>) => {
        handlers.set(kind, handler); // same overwrite semantics as PgJobQueue
      },
    };
    // The generic prompt-based handler bootstrap would have registered:
    let genericRan = false;
    queue.handle("sched:oslo:merge", async () => {
      genericRan = true;
    });
    const registry = fakeRegistry({
      alpha: {
        tools: [
          echoTool({
            name: "alpha_channel_uploads",
            result: () => ({ videos: ["x"] }),
          }),
        ],
      },
      pakman: {
        tools: [echoTool({ name: "pakman", result: () => ({ videos: [] }) })],
      },
      collect: {
        writeTools: [
          echoTool({ name: "collect_playlist_insert", write: true }),
        ],
      },
    });
    registerSpecJobHandlers({
      jobs: queue,
      compiled: compileJobs({
        agent: "oslo",
        spec: specFrom(THREE_STEP),
        resolveSkillIds,
      }),
      deps: { registry, runtime: noRuntime, assetsDir: "/nowhere" },
    });
    expect([...handlers.keys()]).toEqual(["sched:oslo:merge"]);
    await handlers.get("sched:oslo:merge")({});
    expect(genericRan).toBe(false); // spec executor replaced it
    expect(registry.activated).toContain("collect");
  });
});
