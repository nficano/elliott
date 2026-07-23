import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  parseAgentSpec,
  SpecValidationError,
} from "../src/host/spec/schema.js";

const FILE = "agents/oslo.yaml";

const parseSpec = (yamlText: string) =>
  parseAgentSpec({ file: FILE, raw: parseYaml(yamlText) });

const OSLO = `
name: oslo
persona: assets/prompts/oslo
channels: [telegram]

model:
  default: fast
  morning-briefing: standard

config:
  channels: [a, b]

mcp:
  - uses: mcp/memory@red-roster
    with: { url: "http://memory.internal/mcp" }

permissions:
  gmail: read
  youtube: write
  github: none

tools:
  - uses: browser@red-roster
  - uses: youtube@red-roster
    with: { approval: auto }
    secrets:
      oauth: "\${{ secrets.youtube_oauth }}"
  - uses: ./skills/pakman-latest-episode

jobs:
  youtube-dvr:
    on: { schedule: "0 * * * *" }
    steps:
      - id: uploads
        uses: youtube/channel-uploads@red-roster
        with:
          channels: "\${{ config.channels }}"
      - uses: youtube/playlist-insert@red-roster
        with:
          items: "\${{ steps.uploads.outputs.videos }}"
  morning-briefing:
    on: { schedule: "0 7 * * *" }
    steps:
      - turn:
          prompt: prompts/briefing.md
          model: standard
          context:
            digest: "\${{ steps.digest.outputs }}"
      - uses: notify@red-roster
        with:
          body: "\${{ steps.turn.outputs.text }}"
`;

describe("agent-spec schema (AGENT-SPEC §1)", () => {
  test("accepts the oslo-shaped motivating example", () => {
    const spec = parseSpec(OSLO);
    expect(spec.name).toBe("oslo");
    expect(spec.model?.default).toBe("fast");
    expect(spec.model?.["morning-briefing"]).toBe("standard");
    expect(spec.permissions).toEqual({
      gmail: "read",
      youtube: "write",
      github: "none",
    });
    expect(spec.tools).toHaveLength(3);
    expect(Object.keys(spec.jobs ?? {})).toEqual([
      "youtube-dvr",
      "morning-briefing",
    ]);
    const briefing = spec.jobs!["morning-briefing"]!;
    expect(briefing.steps[0]).toHaveProperty("turn");
    const turn = briefing.steps[0] as { turn: { model?: unknown; }; };
    expect(turn.turn.model).toBe("standard");
  });

  test("accepts a turn model as {tier, profile}", () => {
    const spec = parseSpec(`
name: kathleen
jobs:
  tuesday-draft:
    on: { schedule: "0 9 * * 2" }
    steps:
      - turn:
          prompt: prompts/tuesday.md
          model: { tier: standard, profile: writing }
`);
    const step = spec.jobs!["tuesday-draft"]!.steps[0] as {
      turn: { model: { tier: string; profile: string; }; };
    };
    expect(step.turn.model).toEqual({ tier: "standard", profile: "writing" });
  });

  test("accepts a manual-only job", () => {
    const spec = parseSpec(`
name: t
jobs:
  poke:
    on: { manual: true }
    steps:
      - uses: webpage
`);
    expect(spec.jobs!.poke!.on.manual).toBe(true);
  });

  test("rejects unknown top-level keys", () => {
    expect(() => parseSpec("name: x\nworkflows: {}\n")).toThrow(
      SpecValidationError,
    );
    expect(() => parseSpec("name: x\nworkflows: {}\n")).toThrow(/workflows/);
    expect(() => parseSpec("name: x\nworkflows: {}\n")).toThrow(FILE);
  });

  test("rejects a non-mapping spec", () => {
    expect(() => parseAgentSpec({ file: FILE, raw: ["nope"] })).toThrow(
      SpecValidationError,
    );
  });

  test("a step is exactly one of uses/turn", () => {
    const both = `
name: x
jobs:
  j:
    on: { manual: true }
    steps:
      - uses: webpage
        turn: { prompt: p.md }
`;
    const neither = `
name: x
jobs:
  j:
    on: { manual: true }
    steps:
      - id: hmm
`;
    expect(() => parseSpec(both)).toThrow(/exactly one/);
    expect(() => parseSpec(neither)).toThrow(/exactly one/);
  });

  test("job names and step ids must be kebab-case", () => {
    expect(() =>
      parseSpec(`
name: x
jobs:
  Not_Kebab:
    on: { manual: true }
    steps:
      - uses: webpage
`)
    ).toThrow(/kebab-case/);
    expect(() =>
      parseSpec(`
name: x
jobs:
  j:
    on: { manual: true }
    steps:
      - id: Bad_Id
        uses: webpage
`)
    ).toThrow(/kebab-case/);
  });

  test("agent name must be kebab-case", () => {
    expect(() => parseSpec("name: Not Kebab\n")).toThrow(/kebab-case/);
  });

  test("rejects an invalid cron expression", () => {
    expect(() =>
      parseSpec(`
name: x
jobs:
  j:
    on: { schedule: "not a cron" }
    steps:
      - uses: webpage
`)
    ).toThrow(/invalid cron/);
  });

  test("a job needs a schedule or manual trigger and at least one step", () => {
    expect(() =>
      parseSpec(`
name: x
jobs:
  j:
    on: {}
    steps:
      - uses: webpage
`)
    ).toThrow(/schedule/);
    expect(() =>
      parseSpec(`
name: x
jobs:
  j:
    on: { manual: true }
    steps: []
`)
    ).toThrow(/at least one step/);
  });

  test("rejects a bad permission level and a bad tier", () => {
    expect(() => parseSpec("name: x\npermissions: { web: rw }\n")).toThrow(
      SpecValidationError,
    );
    expect(() => parseSpec("name: x\nmodel: { default: gpt-4 }\n")).toThrow(
      SpecValidationError,
    );
  });

  test("rejects malformed uses refs (grammar checked at schema time)", () => {
    expect(() => parseSpec("name: x\ntools:\n  - uses: a/b/c@tag\n")).toThrow(
      SpecValidationError,
    );
    expect(() =>
      parseSpec(`
name: x
jobs:
  j:
    on: { manual: true }
    steps:
      - uses: "youtube@"
`)
    ).toThrow(SpecValidationError);
  });
});
